import type { CheckResult, Monitor, RuntimeCaps } from "../types.js";
import { defaultAssertSafeHostname } from "../util.js";

export async function checkDns(m: Monitor, caps: RuntimeCaps): Promise<CheckResult> {
  const start = (caps.now ?? Date.now)();
  try {
    const host = m.target.replace(/^https?:\/\//, "").split("/")[0].split(":")[0];
    if (!host) throw new Error("Empty hostname");
    (caps.assertSafeHostname ?? defaultAssertSafeHostname)(host);
    const recordType = (m.dns_record_type || "A").toUpperCase();
    const records = await caps.dnsResolve(host, recordType, m.timeout_seconds * 1000, m.dns_resolver ?? undefined);
    const elapsed = Math.round(((caps.now ?? Date.now)()) - start);
    if (!records?.length) {
      return { status: "down", response_time_ms: elapsed, status_code: null, error_message: "No DNS records returned" };
    }
    const expected = m.dns_expected_values ?? [];
    if (expected.length > 0) {
      const flat = records.map((r) => r.value);
      const missing = expected.filter((e) => !flat.some((f) => f.includes(e)));
      if (missing.length > 0) {
        return { status: "down", response_time_ms: elapsed, status_code: null, error_message: `Missing expected DNS values: ${missing.join(", ")}` };
      }
    }
    return { status: "up", response_time_ms: elapsed, status_code: null, error_message: null };
  } catch (e) {
    return { status: "down", response_time_ms: Math.round(((caps.now ?? Date.now)()) - start), status_code: null, error_message: e instanceof Error ? e.message : String(e) };
  }
}
