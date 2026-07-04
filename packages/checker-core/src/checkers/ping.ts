import type { CheckResult, Monitor, RuntimeCaps } from "../types.js";
import { defaultAssertSafeHostname } from "../util.js";

export async function checkPing(m: Monitor, caps: RuntimeCaps): Promise<CheckResult> {
  const host = m.target.replace(/^https?:\/\//, "").split("/")[0].split(":")[0];
  if (!host) return { status: "down", response_time_ms: 0, status_code: null, error_message: "Empty hostname" };
  try { (caps.assertSafeHostname ?? defaultAssertSafeHostname)(host); }
  catch (e) { return { status: "down", response_time_ms: 0, status_code: null, error_message: (e as Error).message }; }

  if (!caps.icmpPing) {
    return {
      status: "down",
      response_time_ms: 0,
      status_code: null,
      error_message: "ICMP ping is not available in this runtime. Use the self-hosted Node worker or edge-runtime image for real ping, or switch this monitor to TCP.",
    };
  }
  try {
    const { rttMs } = await caps.icmpPing(host, m.timeout_seconds * 1000);
    const threshold = m.degraded_threshold_ms ?? 0;
    const status: CheckResult["status"] = threshold > 0 && rttMs > threshold ? "degraded" : "up";
    return { status, response_time_ms: Math.round(rttMs), status_code: null, error_message: status === "degraded" ? `Slow response: ${Math.round(rttMs)}ms > ${threshold}ms` : null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { status: "down", response_time_ms: null, status_code: null, error_message: `ICMP ping failed: ${msg}`.slice(0, 500) };
  }
}
