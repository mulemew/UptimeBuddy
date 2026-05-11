import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { adminClient, persistResult } from "../_shared/persist.ts";
import { runCheck, type Monitor } from "../_shared/checkers.ts";
import { getActiveMaintenanceMonitorIds, isInMaintenance } from "../_shared/maintenance.ts";

const MONITOR_COLS = "id,name,type,target,interval_minutes,timeout_seconds,keyword,keyword_match,expected_status_codes,last_checked_at,last_status,http_method,http_body,http_body_type,http_headers,follow_redirects,ignore_tls_errors,cert_expiry_warn_days,match_mode,degraded_threshold_ms,retry_count,retry_interval_seconds,dns_record_type,dns_resolver,dns_expected_values,steps,db_kind,db_secret_name,db_query,push_token,push_grace_seconds";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
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

    const { data: monitors, error } = await sb
      .from("monitors")
      .select(MONITOR_COLS)
      .eq("enabled", true);
    if (error) throw error;

    const maint = await getActiveMaintenanceMonitorIds(sb);

    const due = (monitors ?? []).filter((m) => {
      if (isInMaintenance(m.id, maint)) return false;
      // Push monitors: only re-evaluate when overdue.
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

    const results = await Promise.allSettled(
      due.map(async (m) => {
        const result = await runCheck(m as unknown as Monitor);
        await persistResult(sb, m as unknown as Monitor & { last_status: string }, result);
        return { id: m.id, status: result.status };
      }),
    );

    return new Response(JSON.stringify({
      now: nowIso,
      total: monitors?.length ?? 0,
      checked: due.length,
      results: results.map((r) => r.status === "fulfilled" ? r.value : { error: String(r.reason) }),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
