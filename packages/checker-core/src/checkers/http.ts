import type { CheckResult, MatchMode, Monitor, RuntimeCaps } from "../types.js";
import { defaultContentType, evaluateMatch, statusCodeMatches, defaultAssertSafeUrl } from "../util.js";

export async function checkHttp(m: Monitor, caps: RuntimeCaps): Promise<CheckResult> {
  const start = (caps.now ?? Date.now)();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), m.timeout_seconds * 1000);
  const method = (m.http_method ?? "GET").toUpperCase();
  const matchMode: MatchMode = (m.match_mode as MatchMode) ?? (m.keyword_match as MatchMode) ?? "contains";
  const followRedirects = m.follow_redirects !== false;
  const ignoreTls = m.ignore_tls_errors === true;
  const wantBody = !!m.keyword && method !== "HEAD";

  const headers = new Headers();
  headers.set("User-Agent", "LovableUptime/1.0");
  const userHeaders = m.http_headers ?? {};
  if (m.http_body && !userHeaders["Content-Type"] && !userHeaders["content-type"]) {
    const ct = defaultContentType(m.http_body_type);
    if (ct) headers.set("Content-Type", ct);
  }
  for (const [k, v] of Object.entries(userHeaders)) {
    if (k && typeof v === "string") headers.set(k, v);
  }

  const init: RequestInit = {
    method, signal: ctrl.signal,
    redirect: followRedirects ? "follow" : "manual",
    headers,
  };
  if (m.http_body && method !== "GET" && method !== "HEAD") init.body = m.http_body;

  let elapsed = 0;
  let statusCode: number | null = null;
  let res: Response | null = null;

  try {
    (caps.assertSafeUrl ?? defaultAssertSafeUrl)(m.target);
    res = await caps.fetch(m.target, init);
    elapsed = Math.round(((caps.now ?? Date.now)()) - start);
    statusCode = res.status;
  } catch (e) {
    elapsed = Math.round(((caps.now ?? Date.now)()) - start);
    const msg = e instanceof Error ? e.message : String(e);
    const isTlsErr = /certificate|tls|ssl/i.test(msg);
    if (ignoreTls && isTlsErr) {
      return { status: "degraded", response_time_ms: elapsed, status_code: null, error_message: `TLS error ignored: ${msg}`, cert_days_remaining: null };
    }
    return { status: "down", response_time_ms: elapsed, status_code: null, error_message: ctrl.signal.aborted ? "Timeout" : msg };
  } finally {
    clearTimeout(timer);
  }

  let codeOk = statusCodeMatches(statusCode!, m.expected_status_codes);
  if (!followRedirects && !codeOk && statusCode! >= 300 && statusCode! < 400) codeOk = true;

  if (!codeOk) {
    try { await res.body?.cancel(); } catch (_) { /* noop */ }
    return { status: "down", response_time_ms: elapsed, status_code: statusCode, error_message: `Unexpected status code ${statusCode}` };
  }

  if (wantBody && m.keyword) {
    const MAX_BYTES = 1_048_576;
    let body = "";
    try {
      const reader = res.body?.getReader();
      if (reader) {
        const chunks: Uint8Array[] = [];
        let total = 0;
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (!value) continue;
          const take = Math.min(value.byteLength, MAX_BYTES - total);
          chunks.push(value.subarray(0, take));
          total += take;
          if (total >= MAX_BYTES) { try { await reader.cancel(); } catch (_) { /* noop */ } break; }
        }
        const buf = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
        body = new TextDecoder().decode(buf);
      }
    } catch (_) { body = ""; }
    const r = evaluateMatch(body, m.keyword, matchMode);
    if (!r.ok) return { status: "down", response_time_ms: elapsed, status_code: statusCode, error_message: r.reason ?? "Keyword check failed" };
  } else {
    try { await res.body?.cancel(); } catch (_) { /* noop */ }
  }

  let certDays: number | null = null;
  const warnDays = m.cert_expiry_warn_days ?? 0;
  if (warnDays > 0 && m.target.startsWith("https://") && caps.tlsCertDaysRemaining) {
    try {
      const u = new URL(m.target);
      const port = u.port ? parseInt(u.port, 10) : 443;
      certDays = await caps.tlsCertDaysRemaining(u.hostname, port, Math.min(5000, m.timeout_seconds * 1000));
    } catch { certDays = null; }
  }

  const threshold = m.degraded_threshold_ms ?? 0;
  if (threshold > 0 && elapsed > threshold) {
    return { status: "degraded", response_time_ms: elapsed, status_code: statusCode, error_message: `Slow response: ${elapsed}ms > ${threshold}ms`, cert_days_remaining: certDays };
  }
  if (certDays != null && certDays < warnDays) {
    return { status: "degraded", response_time_ms: elapsed, status_code: statusCode, error_message: `Certificate expires in ${certDays} day(s)`, cert_days_remaining: certDays };
  }

  return { status: "up", response_time_ms: elapsed, status_code: statusCode, error_message: null, cert_days_remaining: certDays };
}
