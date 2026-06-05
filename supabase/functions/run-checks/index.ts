import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { jwtVerify, createLocalJWKSet, type JWTPayload } from "https://deno.land/x/jose@v5.9.6/index.ts";
import { adminClient, persistResult } from "../_shared/persist.ts";
import { runCheck, type Monitor } from "../_shared/checkers.ts";
import { getActiveMaintenanceMonitorIds, isInMaintenance } from "../_shared/maintenance.ts";

const MONITOR_COLS = "id,name,type,target,interval_minutes,timeout_seconds,keyword,keyword_match,expected_status_codes,last_checked_at,last_status,http_method,http_body,http_body_type,http_headers,follow_redirects,ignore_tls_errors,cert_expiry_warn_days,match_mode,degraded_threshold_ms,retry_count,retry_interval_seconds,dns_record_type,dns_resolver,dns_expected_values,steps,db_kind,db_secret_name,db_query,push_token,push_grace_seconds";

const MAX_CONCURRENCY = Number(Deno.env.get("RUN_CHECKS_CONCURRENCY") ?? 20);
const LOCK_TIMEOUT_SECONDS = 55; // shorter than the 60s scheduler tick

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// Lazy JWKS — populated in Lovable Cloud (signing-keys system); empty in
// self-hosted docker, in which case we fall back to plain SRK equality.
let jwks: ReturnType<typeof createLocalJWKSet> | null = null;
function getJwks() {
  if (jwks) return jwks;
  const raw = Deno.env.get("SUPABASE_JWKS");
  if (!raw) return null;
  try { jwks = createLocalJWKSet(JSON.parse(raw)); return jwks; } catch { return null; }
}

// Accept (a) bearer == SUPABASE_SERVICE_ROLE_KEY (docker / explicit callers),
// or (b) a JWT signed by the project's JWKS with role=service_role — keeps
// pg_cron working after platform key rotation in cloud.
async function isAuthorized(token: string): Promise<boolean> {
  if (!token) return false;
  const expected = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (expected && timingSafeEqual(token, expected)) return true;
  const ks = getJwks();
  if (!ks) return false;
  try {
    const { payload } = await jwtVerify(token, ks) as { payload: JWTPayload & { role?: string } };
    return payload.role === "service_role";
  } catch { return false; }
}

// Tiny p-limit-style helper — caps in-flight async work to N.
async function runPool<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (true) {
      const idx = next++;
      if (idx >= items.length) return;
      try { results[idx] = { status: "fulfilled", value: await fn(items[idx]) }; }
      catch (e) { results[idx] = { status: "rejected", reason: e }; }
    }
  });
  await Promise.all(workers);
  return results;
}

// DB-backed re-entry guard. Returns true if this caller acquired the lock.
async function acquireLock(sb: ReturnType<typeof adminClient>): Promise<boolean> {
  const { data, error } = await sb
    .from("_uptimebuddy_runtime")
    .update({ ts: new Date().toISOString() })
    .eq("key", "run_checks_lock")
    .lt("ts", new Date(Date.now() - LOCK_TIMEOUT_SECONDS * 1000).toISOString())
    .select("key");
  if (error) return true; // fail-open: don't block checks on lock-table issues
  return (data?.length ?? 0) > 0;
}

// Once an hour, prune heartbeats older than the configured retention window.
async function maybeRunRetention(sb: ReturnType<typeof adminClient>) {
  const { data: cfg } = await sb
    .from("_uptimebuddy_runtime")
    .select("ts,val")
    .eq("key", "heartbeats_retention_days")
    .maybeSingle();
  if (!cfg) return;
  const lastTs = cfg.ts ? Date.parse(cfg.ts) : 0;
  if (Date.now() - lastTs < 60 * 60 * 1000) return;
  const days = Math.max(1, parseInt(cfg.val ?? "90", 10));
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  await sb.from("heartbeats").delete().lt("checked_at", cutoff);
  await sb.from("_uptimebuddy_runtime").update({ ts: new Date().toISOString() }).eq("key", "heartbeats_retention_days");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const expected = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const auth = req.headers.get("Authorization") ?? "";
    const provided = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!expected || !timingSafeEqual(provided, expected)) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const sb = adminClient();
    const nowIso = new Date().toISOString();

    if (!(await acquireLock(sb))) {
      return new Response(JSON.stringify({ now: nowIso, skipped: "previous run still in progress" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: monitors, error } = await sb
      .from("monitors")
      .select(MONITOR_COLS)
      .eq("enabled", true);
    if (error) throw error;

    const maint = await getActiveMaintenanceMonitorIds(sb);

    const due = (monitors ?? []).filter((m) => {
      if (isInMaintenance(m.id, maint)) return false;
      if (m.type === "push") {
        const grace = (m.push_grace_seconds ?? 60) * 1000;
        const interval = (m.interval_minutes ?? 5) * 60 * 1000;
        const last = m.last_checked_at ? Date.parse(m.last_checked_at) : 0;
        if (!last) return m.last_status !== "down";
        return Date.now() - last > interval + grace;
      }
      if (!m.last_checked_at) return true;
      const next = Date.parse(m.last_checked_at) + m.interval_minutes * 60 * 1000;
      return Date.now() >= next - 5_000;
    });

    const results = await runPool(due, MAX_CONCURRENCY, async (m) => {
      const result = await runCheck(m as unknown as Monitor);
      await persistResult(sb, m as unknown as Monitor & { last_status: string }, result);
      return { id: m.id, status: result.status };
    });

    // Best-effort retention cleanup — never blocks the response on failure.
    maybeRunRetention(sb).catch((e) => console.error("retention cleanup failed", e));

    return new Response(JSON.stringify({
      now: nowIso,
      total: monitors?.length ?? 0,
      checked: due.length,
      results: results.map((r) => r.status === "fulfilled" ? r.value : { error: "check failed" }),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("run-checks failed", e);
    return new Response(JSON.stringify({ error: "internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
