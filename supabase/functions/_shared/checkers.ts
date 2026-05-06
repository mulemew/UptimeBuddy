// Shared monitor checker logic used by run-checks and check-now.

export type MonitorType = "http" | "tcp" | "ping";
export type MatchMode = "contains" | "not_contains" | "regex";

export interface Monitor {
  id: string;
  name: string;
  type: MonitorType;
  target: string;
  timeout_seconds: number;
  keyword: string | null;
  keyword_match: "contains" | "not_contains" | null;
  expected_status_codes: string;
  // Extended HTTP fields (optional for backward compat)
  http_method?: string;
  http_body?: string | null;
  http_body_type?: string | null;
  http_headers?: Record<string, string> | null;
  follow_redirects?: boolean;
  ignore_tls_errors?: boolean;
  cert_expiry_warn_days?: number;
  match_mode?: MatchMode;
  degraded_threshold_ms?: number | null;
}

export interface CheckResult {
  status: "up" | "down" | "degraded";
  response_time_ms: number | null;
  status_code: number | null;
  error_message: string | null;
  cert_days_remaining?: number | null;
}

function statusCodeMatches(code: number, spec: string): boolean {
  return spec.split(",").map((s) => s.trim()).filter(Boolean).some((part) => {
    if (part.includes("-")) {
      const [a, b] = part.split("-").map((x) => parseInt(x, 10));
      return code >= a && code <= b;
    }
    return parseInt(part, 10) === code;
  });
}

function defaultContentType(bodyType?: string | null): string | null {
  switch (bodyType) {
    case "json": return "application/json";
    case "xml": return "application/xml";
    case "form": return "application/x-www-form-urlencoded";
    case "text": return "text/plain";
    default: return null;
  }
}

async function getCertDaysRemaining(target: string, timeoutMs: number): Promise<number | null> {
  try {
    const u = new URL(target);
    if (u.protocol !== "https:") return null;
    const port = u.port ? parseInt(u.port, 10) : 443;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let conn: Deno.TlsConn | null = null;
    try {
      conn = await Deno.connectTls({ hostname: u.hostname, port });
      // @ts-ignore: handshake exists at runtime
      const info = await conn.handshake();
      const certs = info?.peerCertificates as Array<{ notAfter?: string }> | undefined;
      if (!certs?.length) return null;
      const notAfter = certs[0].notAfter;
      if (!notAfter) return null;
      const days = Math.floor((Date.parse(notAfter) - Date.now()) / 86_400_000);
      return days;
    } finally {
      clearTimeout(timer);
      try { conn?.close(); } catch (_) { /* noop */ }
    }
  } catch (_) {
    return null;
  }
}

function evaluateMatch(body: string, keyword: string, mode: MatchMode): { ok: boolean; reason?: string } {
  if (mode === "regex") {
    try {
      const re = new RegExp(keyword);
      return re.test(body)
        ? { ok: true }
        : { ok: false, reason: `Regex /${keyword}/ did not match` };
    } catch (e) {
      return { ok: false, reason: `Invalid regex: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  const has = body.includes(keyword);
  if (mode === "not_contains") {
    return has ? { ok: false, reason: `Forbidden keyword "${keyword}" present` } : { ok: true };
  }
  return has ? { ok: true } : { ok: false, reason: `Keyword "${keyword}" not found` };
}

async function checkHttp(m: Monitor, opts: { forceReadBody?: boolean } = {}): Promise<CheckResult> {
  const start = performance.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), m.timeout_seconds * 1000);
  const method = (m.http_method ?? "GET").toUpperCase();
  const matchMode: MatchMode = (m.match_mode as MatchMode) ?? (m.keyword_match as MatchMode) ?? "contains";
  const followRedirects = m.follow_redirects !== false;
  const ignoreTls = m.ignore_tls_errors === true;
  const wantBody = opts.forceReadBody || (!!m.keyword && method !== "HEAD");

  // Build headers
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
    method,
    signal: ctrl.signal,
    redirect: followRedirects ? "follow" : "manual",
    headers,
  };
  if (m.http_body && method !== "GET" && method !== "HEAD") {
    init.body = m.http_body;
  }

  let elapsed = 0;
  let statusCode: number | null = null;
  let res: Response | null = null;

  try {
    res = await fetch(m.target, init);
    elapsed = Math.round(performance.now() - start);
    statusCode = res.status;
  } catch (e) {
    elapsed = Math.round(performance.now() - start);
    const msg = e instanceof Error ? e.message : String(e);
    const isTlsErr = /certificate|tls|ssl/i.test(msg);
    if (ignoreTls && isTlsErr) {
      // Treat TLS errors as degraded (we cannot truly bypass in Deno fetch).
      return {
        status: "degraded",
        response_time_ms: elapsed,
        status_code: null,
        error_message: `TLS error ignored: ${msg}`,
        cert_days_remaining: null,
      };
    }
    return {
      status: "down",
      response_time_ms: elapsed,
      status_code: null,
      error_message: ctrl.signal.aborted ? "Timeout" : msg,
    };
  } finally {
    clearTimeout(timer);
  }

  // Status code: when not following redirects, treat 3xx as OK by default.
  let codeOk = statusCodeMatches(statusCode, m.expected_status_codes);
  if (!followRedirects && !codeOk && statusCode >= 300 && statusCode < 400) {
    codeOk = true;
  }

  if (!codeOk) {
    try { await res.body?.cancel(); } catch (_) { /* noop */ }
    return {
      status: "down",
      response_time_ms: elapsed,
      status_code: statusCode,
      error_message: `Unexpected status code ${statusCode}`,
    };
  }

  // Body / keyword check
  if (wantBody && m.keyword) {
    let body = "";
    try { body = await res.text(); } catch (_) { body = ""; }
    const r = evaluateMatch(body, m.keyword, matchMode);
    if (!r.ok) {
      return {
        status: "down",
        response_time_ms: elapsed,
        status_code: statusCode,
        error_message: r.reason ?? "Keyword check failed",
      };
    }
  } else {
    try { await res.body?.cancel(); } catch (_) { /* noop */ }
  }

  // Cert expiry (HTTPS only, when enabled)
  let certDays: number | null = null;
  const warnDays = m.cert_expiry_warn_days ?? 0;
  if (warnDays > 0 && m.target.startsWith("https://")) {
    certDays = await getCertDaysRemaining(m.target, Math.min(5000, m.timeout_seconds * 1000));
  }

  // Degraded checks
  const threshold = m.degraded_threshold_ms ?? 0;
  if (threshold > 0 && elapsed > threshold) {
    return {
      status: "degraded",
      response_time_ms: elapsed,
      status_code: statusCode,
      error_message: `Slow response: ${elapsed}ms > ${threshold}ms`,
      cert_days_remaining: certDays,
    };
  }
  if (certDays != null && certDays < warnDays) {
    return {
      status: "degraded",
      response_time_ms: elapsed,
      status_code: statusCode,
      error_message: `Certificate expires in ${certDays} day(s)`,
      cert_days_remaining: certDays,
    };
  }

  return {
    status: "up",
    response_time_ms: elapsed,
    status_code: statusCode,
    error_message: null,
    cert_days_remaining: certDays,
  };
}

async function checkTcp(m: Monitor): Promise<CheckResult> {
  const [host, portStr] = m.target.split(":");
  const port = parseInt(portStr, 10);
  if (!host || !port) {
    return { status: "down", response_time_ms: null, status_code: null, error_message: "Invalid target, expected host:port" };
  }
  const start = performance.now();
  let conn: Deno.TcpConn | null = null;
  const timer = setTimeout(() => { try { conn?.close(); } catch (_) { /* noop */ } }, m.timeout_seconds * 1000);
  try {
    conn = await Deno.connect({ hostname: host, port, transport: "tcp" });
    const elapsed = Math.round(performance.now() - start);
    return { status: "up", response_time_ms: elapsed, status_code: null, error_message: null };
  } catch (e) {
    const elapsed = Math.round(performance.now() - start);
    return {
      status: "down",
      response_time_ms: elapsed,
      status_code: null,
      error_message: e instanceof Error ? e.message : String(e),
    };
  } finally {
    clearTimeout(timer);
    try { conn?.close(); } catch (_) { /* noop */ }
  }
}

async function checkPing(m: Monitor): Promise<CheckResult> {
  const host = m.target.replace(/^https?:\/\//, "").split("/")[0];
  const url = `https://${host}`;
  return await checkHttp({ ...m, target: url, expected_status_codes: "100-599", http_method: "HEAD", keyword: null });
}

export async function runCheck(m: Monitor): Promise<CheckResult> {
  switch (m.type) {
    case "http": return await checkHttp(m, { forceReadBody: false });
    case "keyword": return await checkHttp(m, { forceReadBody: true });
    case "tcp": return await checkTcp(m);
    case "ping": return await checkPing(m);
  }
}
