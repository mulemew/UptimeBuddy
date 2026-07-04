import type { CheckResult, Monitor, RuntimeCaps } from "../types.js";
import { defaultAssertSafeHostPort } from "../util.js";

export async function checkTcp(m: Monitor, caps: RuntimeCaps): Promise<CheckResult> {
  let host: string; let port: number;
  try {
    ({ host, port } = (caps.assertSafeHostPort ?? defaultAssertSafeHostPort)(m.target));
  } catch (e) {
    return { status: "down", response_time_ms: null, status_code: null, error_message: e instanceof Error ? e.message : String(e) };
  }
  try {
    const rtt = await caps.tcpConnect(host, port, m.timeout_seconds * 1000);
    const threshold = m.degraded_threshold_ms ?? 0;
    const status: CheckResult["status"] = threshold > 0 && rtt > threshold ? "degraded" : "up";
    const err = status === "degraded" ? `Slow response: ${rtt}ms > ${threshold}ms` : null;
    return { status, response_time_ms: rtt, status_code: null, error_message: err };
  } catch (e) {
    return { status: "down", response_time_ms: null, status_code: null, error_message: e instanceof Error ? e.message : String(e) };
  }
}
