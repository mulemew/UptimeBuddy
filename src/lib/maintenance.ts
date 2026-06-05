import type { MaintenanceWindow } from "@/lib/monitors";

// IMPORTANT: Recurrence rules (daily/weekly) are evaluated in **UTC** so the
// frontend and the edge-runtime checker (running in UTC) always agree on whether
// a window is active. When the user picks "02:00" in a local form, the saved
// `starts_at` is converted to UTC by the browser, and both client and server
// then interpret "02:00 UTC" the same way.
export function isWindowActive(w: MaintenanceWindow, now: Date = new Date()): boolean {
  const s = new Date(w.starts_at);
  const e = new Date(w.ends_at);
  if (w.recurrence === "none") return now >= s && now <= e;
  const dur = e.getTime() - s.getTime();
  const todayStart = new Date(now);
  todayStart.setUTCHours(s.getUTCHours(), s.getUTCMinutes(), 0, 0);
  if (w.recurrence === "daily") {
    return now.getTime() >= todayStart.getTime() && now.getTime() <= todayStart.getTime() + dur;
  }
  if (w.recurrence === "weekly") {
    if (w.weekday == null || now.getUTCDay() !== w.weekday) return false;
    return now.getTime() >= todayStart.getTime() && now.getTime() <= todayStart.getTime() + dur;
  }
  return false;
}

export function activeMaintenanceFor(windows: MaintenanceWindow[], monitorId: string, now: Date = new Date()): boolean {
  return windows.some((w) => isWindowActive(w, now) && (w.monitor_id == null || w.monitor_id === monitorId));
}
