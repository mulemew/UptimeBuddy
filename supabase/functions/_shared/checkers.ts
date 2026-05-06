// Shared monitor checker logic used by run-checks and check-now.

export type MonitorType = "http" | "tcp" | "ping" | "keyword";

export interface Monitor {
  id: string;
  name: string;
  type: MonitorType;
  target: string;
  timeout_seconds: number;
  keyword: string | null;
  keyword_match: "contains" | "not_contains" | null;
  expected_status_codes: string;
}

export interface CheckResult {
  status: "up" | "down";
  response_time_ms: number | null;
  status_code: number | null;
  error_message: string | null;
}

function statusCodeMatches(code: number, spec: string): boolean {
  return spec.split(",").map((s) => s.trim()).some((part) => {
    if (part.includes("-")) {
      const [a, b] = part.split("-").map((x) => parseInt(x, 10));
      return code >= a && code <= b;
    }
    return parseInt(part, 10) === code;
  });
}

async function checkHttp(m: Monitor, withBody = false): Promise<CheckResult> {
  const start = performance.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), m.timeout_seconds * 1000);
  try {
    const res = await fetch(m.target, {
      method: withBody ? "GET" : "GET",
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": "LovableUptime/1.0" },
    });
    const elapsed = Math.round(performance.now() - start);
    let body = "";
    if (withBody) body = await res.text();
    const codeOk = statusCodeMatches(res.status, m.expected_status_codes);

    if (!codeOk) {
      return {
        status: "down",
        response_time_ms: elapsed,
        status_code: res.status,
        error_message: `Unexpected status code ${res.status}`,
      };
    }

    if (withBody && m.keyword) {
      const has = body.includes(m.keyword);
      const wantContains = m.keyword_match !== "not_contains";
      const ok = wantContains ? has : !has;
      if (!ok) {
        return {
          status: "down",
          response_time_ms: elapsed,
          status_code: res.status,
          error_message: wantContains
            ? `Keyword "${m.keyword}" not found`
            : `Forbidden keyword "${m.keyword}" present`,
        };
      }
    }

    return { status: "up", response_time_ms: elapsed, status_code: res.status, error_message: null };
  } catch (e) {
    const elapsed = Math.round(performance.now() - start);
    const msg = e instanceof Error ? e.message : String(e);
    return {
      status: "down",
      response_time_ms: elapsed,
      status_code: null,
      error_message: ctrl.signal.aborted ? "Timeout" : msg,
    };
  } finally {
    clearTimeout(timer);
  }
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
  // ICMP not available in edge functions — fall back to HTTPS HEAD on the host.
  const host = m.target.replace(/^https?:\/\//, "").split("/")[0];
  const url = `https://${host}`;
  return await checkHttp({ ...m, target: url, expected_status_codes: "100-599" });
}

export async function runCheck(m: Monitor): Promise<CheckResult> {
  switch (m.type) {
    case "http": return await checkHttp(m, false);
    case "keyword": return await checkHttp(m, true);
    case "tcp": return await checkTcp(m);
    case "ping": return await checkPing(m);
  }
}
