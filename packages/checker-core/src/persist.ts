// Minimal Supabase-REST-based persistence that works in any JS runtime with
// global fetch (Node 18+, Deno, CF Workers, browsers). Adapters can pass their
// own SupabaseClient instead by calling the functional API below.

import type { CheckResult, Monitor } from "./types.js";

export interface SupabaseLike {
  from(table: string): {
    insert(rows: unknown): Promise<{ error: unknown }>;
    update(patch: unknown): {
      eq(col: string, val: unknown): Promise<{ error: unknown }>;
    };
    select(cols: string): {
      eq(col: string, val: unknown): {
        is(col: string, val: null): {
          order(col: string, opts: { ascending: boolean }): {
            limit(n: number): {
              maybeSingle(): Promise<{ data: { id: string; started_at: string } | null; error: unknown }>;
            };
          };
        };
      };
    };
  };
}

export async function persistResult(
  sb: SupabaseLike,
  monitor: Monitor & { last_status: string },
  result: CheckResult,
): Promise<void> {
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
