// Long-running Node worker for self-hosted deployments that want a smaller
// footprint than the full Supabase edge-runtime stack. Wakes every 60s and
// runs the same check loop that pg_cron would have triggered.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { persistResult, tick, type Monitor } from "@uptimebuddy/checker-core";
import { caps } from "./caps.js";

const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SERVICE_ROLE = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const CONCURRENCY = parseInt(process.env.CONCURRENCY ?? "20", 10);
const TICK_MS = parseInt(process.env.TICK_MS ?? "60000", 10);

const MONITOR_COLS = "id,name,type,target,interval_minutes,timeout_seconds,keyword,keyword_match,expected_status_codes,last_checked_at,last_status,enabled,http_method,http_body,http_body_type,http_headers,follow_redirects,ignore_tls_errors,cert_expiry_warn_days,match_mode,degraded_threshold_ms,retry_count,retry_interval_seconds,dns_record_type,dns_resolver,dns_expected_values,steps,db_kind,db_secret_name,db_query,push_token,push_grace_seconds";

function requireEnv(k: string): string {
  const v = process.env[k];
  if (!v) { console.error(`missing env ${k}`); process.exit(1); }
  return v;
}

const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function loadMaintenance(client: SupabaseClient): Promise<Set<string>> {
  const nowIso = new Date().toISOString();
  const { data } = await client.from("maintenance_windows")
    .select("monitor_id, starts_at, ends_at")
    .lte("starts_at", nowIso).gte("ends_at", nowIso);
  const set = new Set<string>();
  for (const row of data ?? []) if (row.monitor_id) set.add(row.monitor_id as string);
  return set;
}

let running = false;
async function runOnce() {
  if (running) { console.log("skip: previous tick still running"); return; }
  running = true;
  try {
    const { data: monitors, error } = await sb.from("monitors").select(MONITOR_COLS).eq("enabled", true);
    if (error) throw error;
    const maint = await loadMaintenance(sb);
    const r = await tick(
      (monitors ?? []) as unknown as Monitor[],
      caps,
      {
        maintenanceMonitorIds: maint,
        concurrency: CONCURRENCY,
        onResult: async (m, result) => {
          await persistResult(
            sb as unknown as Parameters<typeof persistResult>[0],
            m as Monitor & { last_status: string },
            result,
          );
        },
      },
    );
    console.log(`[${new Date().toISOString()}] checked ${r.checked}/${r.total}`);
  } catch (e) {
    console.error("tick failed", e);
  } finally { running = false; }
}

console.log(`uptimebuddy node-worker starting; tick=${TICK_MS}ms concurrency=${CONCURRENCY}`);
runOnce();
setInterval(runOnce, TICK_MS);
