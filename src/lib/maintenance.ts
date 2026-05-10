import type { MaintenanceWindow } from "@/lib/monitors";

export function isWindowActive(w: MaintenanceWindow, now: Date = new Date()): boolean {
  const s = new Date(w.starts_at);
  const e = new Date(w.ends_at);
  if (w.recurrence === "none") return now >= s && now <= e;
  const dur = e.getTime() - s.getTime();
  const todayStart = new Date(now);
  todayStart.setHours(s.getHours(), s.getMinutes(), 0, 0);
  if (w.recurrence === "daily") {
    return now.getTime() >= todayStart.getTime() && now.getTime() <= todayStart.getTime() + dur;
  }
  if (w.recurrence === "weekly") {
    if (w.weekday == null || now.getDay() !== w.weekday) return false;
    return now.getTime() >= todayStart.getTime() && now.getTime() <= todayStart.getTime() + dur;
  }
  return false;
}

export function activeMaintenanceFor(windows: MaintenanceWindow[], monitorId: string, now: Date = new Date()): boolean {
  return windows.some((w) => isWindowActive(w, now) && (w.monitor_id == null || w.monitor_id === monitorId));
}
