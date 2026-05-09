// Helpers for maintenance window evaluation.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export interface MaintWindow {
  id: string;
  monitor_id: string | null;
  starts_at: string;
  ends_at: string;
  recurrence: string;
  weekday: number | null;
}

function inWindow(w: MaintWindow, now: Date): boolean {
  const s = new Date(w.starts_at);
  const e = new Date(w.ends_at);
  if (w.recurrence === "none") {
    return now >= s && now <= e;
  }
  if (w.recurrence === "daily") {
    const todayStart = new Date(now);
    todayStart.setUTCHours(s.getUTCHours(), s.getUTCMinutes(), 0, 0);
    const dur = e.getTime() - s.getTime();
    return now.getTime() >= todayStart.getTime() && now.getTime() <= todayStart.getTime() + dur;
  }
  if (w.recurrence === "weekly") {
    if (w.weekday == null || now.getUTCDay() !== w.weekday) return false;
    const todayStart = new Date(now);
    todayStart.setUTCHours(s.getUTCHours(), s.getUTCMinutes(), 0, 0);
    const dur = e.getTime() - s.getTime();
    return now.getTime() >= todayStart.getTime() && now.getTime() <= todayStart.getTime() + dur;
  }
  return false;
}

export async function getActiveMaintenanceMonitorIds(sb: SupabaseClient): Promise<{ all: boolean; ids: Set<string> }> {
  const { data } = await sb.from("maintenance_windows").select("id,monitor_id,starts_at,ends_at,recurrence,weekday");
  const now = new Date();
  let all = false;
  const ids = new Set<string>();
  for (const w of (data ?? []) as MaintWindow[]) {
    if (!inWindow(w, now)) continue;
    if (w.monitor_id == null) all = true;
    else ids.add(w.monitor_id);
  }
  return { all, ids };
}

export function isInMaintenance(monitorId: string, m: { all: boolean; ids: Set<string> }): boolean {
  return m.all || m.ids.has(monitorId);
}
