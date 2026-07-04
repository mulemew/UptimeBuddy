import type { CheckResult, Monitor, RuntimeCaps } from "../types.js";
import { defaultAssertSafeUrl, defaultContentType, getJsonPath, renderTemplate, statusCodeMatches } from "../util.js";

export async function checkMultiStep(m: Monitor, caps: RuntimeCaps): Promise<CheckResult> {
  const start = (caps.now ?? Date.now)();
  const steps = m.steps ?? [];
  if (!steps.length) return { status: "down", response_time_ms: 0, status_code: null, error_message: "No steps configured" };
  const ctx: Record<string, string> = {};
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const stepName = s.name || `Step ${i + 1}`;
    try {
      const url = renderTemplate(s.url, ctx);
      (caps.assertSafeUrl ?? defaultAssertSafeUrl)(url);
      const headers = new Headers({ "User-Agent": "LovableUptime/1.0" });
      for (const [k, v] of Object.entries(s.headers ?? {})) headers.set(k, renderTemplate(v, ctx));
      if (s.body && !headers.has("Content-Type")) {
        const ct = defaultContentType(s.body_type);
        if (ct) headers.set("Content-Type", ct);
      }
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), m.timeout_seconds * 1000);
      let res: Response;
      try {
        res = await caps.fetch(url, {
          method: (s.method || "GET").toUpperCase(),
          headers,
          body: s.body ? renderTemplate(s.body, ctx) : undefined,
          signal: ctrl.signal,
          redirect: "follow",
        });
      } finally { clearTimeout(timer); }
      const expectedCodes = s.expected_status_codes || "200-299";
      if (!statusCodeMatches(res.status, expectedCodes)) {
        try { await res.body?.cancel(); } catch (_) { /* noop */ }
        return { status: "down", response_time_ms: Math.round(((caps.now ?? Date.now)()) - start), status_code: res.status, error_message: `${stepName}: status ${res.status} not in ${expectedCodes}`, step_name: stepName };
      }
      const text = await res.text();
      let json: unknown = undefined;
      const needsJson = (s.extract?.some((e) => e.from === "json")) || (s.assert?.some((a) => a.from === "json"));
      if (needsJson) { try { json = JSON.parse(text); } catch (_) { /* not json */ } }
      for (const ex of s.extract ?? []) {
        let val: unknown;
        if (ex.from === "header") val = res.headers.get(ex.path);
        else val = getJsonPath(json, ex.path);
        if (val != null) ctx[ex.name] = String(val);
      }
      for (const a of s.assert ?? []) {
        const from = a.from || "body";
        let actual: string;
        if (from === "header") actual = res.headers.get(a.path || "") ?? "";
        else if (from === "json") actual = String(getJsonPath(json, a.path || "") ?? "");
        else actual = text;
        const expected = renderTemplate(a.value, ctx);
        let ok = false;
        if (a.op === "eq") ok = actual === expected;
        else if (a.op === "contains") ok = actual.includes(expected);
        else if (a.op === "regex") { try { ok = new RegExp(expected).test(actual); } catch { ok = false; } }
        if (!ok) {
          return { status: "down", response_time_ms: Math.round(((caps.now ?? Date.now)()) - start), status_code: res.status, error_message: `${stepName}: assertion ${a.op} failed`, step_name: stepName };
        }
      }
    } catch (e) {
      return { status: "down", response_time_ms: Math.round(((caps.now ?? Date.now)()) - start), status_code: null, error_message: `${stepName}: ${e instanceof Error ? e.message : String(e)}`, step_name: stepName };
    }
  }
  const elapsed = Math.round(((caps.now ?? Date.now)()) - start);
  const threshold = m.degraded_threshold_ms ?? 0;
  if (threshold > 0 && elapsed > threshold) {
    return { status: "degraded", response_time_ms: elapsed, status_code: null, error_message: `Slow response: ${elapsed}ms > ${threshold}ms` };
  }
  return { status: "up", response_time_ms: elapsed, status_code: null, error_message: null };
}
