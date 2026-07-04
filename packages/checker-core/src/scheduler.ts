// Selects due monitors and dispatches checks with bounded concurrency.
// Adapter is responsible for reading monitors + maintenance list from the DB
// and passing them in; this keeps the core free of any DB driver dependency.

import type { CheckResult, Monitor, RuntimeCaps } from "./types.js";
import { runCheck } from "./checkers/index.js";

export interface DueOptions {
  now?: number;
  maintenanceMonitorIds?: Set<string>;
}

export function selectDueMonitors(monitors: Monitor[], opts: DueOptions = {}): Monitor[] {
  const now = opts.now ?? Date.now();
  const maint = opts.maintenanceMonitorIds ?? new Set<string>();
  return monitors.filter((m) => {
    if (m.enabled === false) return false;
    if (maint.has(m.id)) return false;
    if (m.type === "push") {
      const grace = (m.push_grace_seconds ?? 60) * 1000;
      const interval = (m.interval_minutes ?? 5) * 60 * 1000;
      const last = m.last_checked_at ? Date.parse(m.last_checked_at) : 0;
      if (!last) return m.last_status !== "down";
      return now - last > interval + grace;
    }
    if (!m.last_checked_at) return true;
    const next = Date.parse(m.last_checked_at) + (m.interval_minutes ?? 5) * 60 * 1000;
    return now >= next - 5_000;
  });
}

export async function runPool<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
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

export interface TickOptions {
  concurrency?: number;
  onResult?: (monitor: Monitor, result: CheckResult) => Promise<void> | void;
}

export async function tick(monitors: Monitor[], caps: RuntimeCaps, opts: TickOptions & DueOptions = {}) {
  const due = selectDueMonitors(monitors, opts);
  const n = opts.concurrency ?? 20;
  const results = await runPool(due, n, async (m) => {
    const result = await runCheck(m, caps);
    if (opts.onResult) await opts.onResult(m, result);
    return { id: m.id, status: result.status };
  });
  return { total: monitors.length, checked: due.length, results };
}
