import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import type { Monitor, CheckResult } from "./checkers.ts";

export function adminClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

export async function persistResult(sb: SupabaseClient, monitor: Monitor & { last_status: string }, result: CheckResult) {
  const checkedAt = new Date().toISOString();

  await sb.from("heartbeats").insert({
    monitor_id: monitor.id,
    checked_at: checkedAt,
    status: result.status,
    response_time_ms: result.response_time_ms,
    status_code: result.status_code,
    error_message: result.error_message,
    cert_days_remaining: result.cert_days_remaining ?? null,
    step_name: result.step_name ?? null,
  });

  await sb.from("monitors").update({
    last_checked_at: checkedAt,
    last_status: result.status,
  }).eq("id", monitor.id);

  // Incidents only on hard down (degraded does not open an incident).
  if (monitor.last_status !== "down" && result.status === "down") {
    await sb.from("incidents").insert({
      monitor_id: monitor.id,
      started_at: checkedAt,
      reason: result.error_message ?? "Check failed",
    });
  } else if (monitor.last_status === "down" && result.status !== "down") {
    const { data: open } = await sb
      .from("incidents")
      .select("id, started_at")
      .eq("monitor_id", monitor.id)
      .is("ended_at", null)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (open) {
      const duration = Math.round((Date.parse(checkedAt) - Date.parse(open.started_at)) / 1000);
      await sb.from("incidents").update({
        ended_at: checkedAt,
        duration_seconds: duration,
      }).eq("id", open.id);
    }
  }
}
