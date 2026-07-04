// Cloudflare Worker entry.
//
// scheduled() is invoked by the cron trigger every minute; fetch() supports
// manual test invocations (POST /run with Authorization: Bearer <CRON_SECRET or
// SUPABASE_SERVICE_ROLE_KEY>).

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { persistResult, tick, type Monitor } from "@uptimebuddy/checker-core";
import { caps } from "./caps.js";

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  CRON_SECRET?: string;
  CONCURRENCY?: string;
}

const MONITOR_COLS = "id,name,type,target,interval_minutes,timeout_seconds,keyword,keyword_match,expected_status_codes,last_checked_at,last_status,enabled,http_method,http_body,http_body_type,http_headers,follow_redirects,ignore_tls_errors,cert_expiry_warn_days,match_mode,degraded_threshold_ms,retry_count,retry_interval_seconds,dns_record_type,dns_resolver,dns_expected_values,steps,db_kind,db_secret_name,db_query,push_token,push_grace_seconds";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function loadMaintenance(sb: SupabaseClient): Promise<Set<string>> {
  const nowIso = new Date().toISOString();
  const { data } = await sb.from("maintenance_windows")
    .select("monitor_id, starts_at, ends_at")
    .lte("starts_at", nowIso).gte("ends_at", nowIso);
  const set = new Set<string>();
  for (const row of data ?? []) if (row.monitor_id) set.add(row.monitor_id as string);
  return set;
}

async function runOnce(env: Env): Promise<{ total: number; checked: number }> {
  const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: monitors, error } = await sb.from("monitors").select(MONITOR_COLS).eq("enabled", true);
  if (error) throw error;
  const maint = await loadMaintenance(sb);
  return await tick(
    (monitors ?? []) as unknown as Monitor[],
    caps,
    {
      maintenanceMonitorIds: maint,
      concurrency: parseInt(env.CONCURRENCY ?? "20", 10),
      onResult: async (m, result) => {
        await persistResult(
          sb as unknown as Parameters<typeof persistResult>[0],
          m as Monitor & { last_status: string },
          result,
        );
      },
    },
  );
}

async function isAuthorized(env: Env, req: Request): Promise<boolean> {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return false;
  if (env.SUPABASE_SERVICE_ROLE_KEY && timingSafeEqual(token, env.SUPABASE_SERVICE_ROLE_KEY)) return true;
  if (env.CRON_SECRET && timingSafeEqual(token, env.CRON_SECRET)) return true;
  return false;
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runOnce(env).then(
      (r) => console.log(`checked ${r.checked}/${r.total}`),
      (e) => console.error("run failed", e),
    ));
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/") {
      return new Response("uptimebuddy CF worker OK");
    }
    if (req.method === "POST" && url.pathname === "/run") {
      if (!(await isAuthorized(env, req))) return new Response("unauthorized", { status: 401 });
      const r = await runOnce(env);
      return Response.json(r);
    }
    return new Response("not found", { status: 404 });
  },
};
