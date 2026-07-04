import type { CheckResult, Monitor, RuntimeCaps } from "../types.js";
import { checkHttp } from "./http.js";
import { checkTcp } from "./tcp.js";
import { checkPing } from "./ping.js";
import { checkDns } from "./dns.js";
import { checkMultiStep } from "./multistep.js";

export async function runCheck(monitor: Monitor, caps: RuntimeCaps): Promise<CheckResult> {
  const attempts = Math.max(1, (monitor.retry_count ?? 0) + 1);
  const gap = Math.max(0, (monitor.retry_interval_seconds ?? 0) * 1000);
  let last: CheckResult = { status: "down", response_time_ms: null, status_code: null, error_message: "not executed" };
  for (let i = 0; i < attempts; i++) {
    last = await runOnce(monitor, caps);
    if (last.status !== "down") return last;
    if (i < attempts - 1 && gap) await new Promise((r) => setTimeout(r, gap));
  }
  return last;
}

async function runOnce(m: Monitor, caps: RuntimeCaps): Promise<CheckResult> {
  switch (m.type) {
    case "http": return checkHttp(m, caps);
    case "tcp": return checkTcp(m, caps);
    case "ping": return checkPing(m, caps);
    case "dns": return checkDns(m, caps);
    case "multistep": return checkMultiStep(m, caps);
    case "database":
      return { status: "down", response_time_ms: null, status_code: null, error_message: "Database checks are not supported in this runtime. Use the self-hosted edge-runtime for database monitors." };
    case "push":
      // Push monitors don't self-check; the scheduler decides up/down based on grace window.
      return { status: "up", response_time_ms: null, status_code: null, error_message: null };
    default:
      return { status: "down", response_time_ms: null, status_code: null, error_message: `Unknown monitor type: ${(m as { type: string }).type}` };
  }
}

export { checkHttp, checkTcp, checkPing, checkDns, checkMultiStep };
