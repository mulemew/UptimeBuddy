// Shared monitor checker logic used by run-checks and check-now.
import { assertSafeUrl, assertSafeHostPort, assertSafeHostname } from "./ssrf.ts";

export type MonitorType = "http" | "tcp" | "ping" | "dns" | "multistep" | "database" | "push";
export type MatchMode = "contains" | "not_contains" | "regex";

export interface MonitorStep {
  name?: string;
  method?: string;
  url: string;
  headers?: Record<string, string>;
  body?: string | null;
  body_type?: string | null;
  expected_status_codes?: string;
  extract?: { name: string; from: "json" | "header"; path: string }[];
  assert?: { from?: "json" | "body" | "header"; path?: string; op: "eq" | "contains" | "regex"; value: string }[];
}

export interface Monitor {
  id: string;
  name: string;
  type: MonitorType;
  target: string;
  timeout_seconds: number;
  keyword: string | null;
  keyword_match: "contains" | "not_contains" | null;
  expected_status_codes: string;
  http_method?: string;
  http_body?: string | null;
  http_body_type?: string | null;
  http_headers?: Record<string, string> | null;
  follow_redirects?: boolean;
  ignore_tls_errors?: boolean;
  cert_expiry_warn_days?: number;
  match_mode?: MatchMode;
  degraded_threshold_ms?: number | null;
  retry_count?: number;
  retry_interval_seconds?: number;
  // dns
  dns_record_type?: string | null;
  dns_resolver?: string | null;
  dns_expected_values?: string[] | null;
  // multistep
  steps?: MonitorStep[];
  // database
  db_kind?: string | null;
  db_secret_name?: string | null;
  db_query?: string | null;
  // push
  push_token?: string | null;
  push_grace_seconds?: number;
  interval_minutes?: number;
  last_checked_at?: string | null;
}

export interface CheckResult {
  status: "up" | "down" | "degraded";
  response_time_ms: number | null;
  status_code: number | null;
  error_message: string | null;
  cert_days_remaining?: number | null;
  step_name?: string | null;
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
      // @ts-ignore handshake exists at runtime
      const info = await conn.handshake();
      const certs = info?.peerCertificates as Array<{ notAfter?: string }> | undefined;
      if (!certs?.length) return null;
      const notAfter = certs[0].notAfter;
      if (!notAfter) return null;
      return Math.floor((Date.parse(notAfter) - Date.now()) / 86_400_000);
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
      return re.test(body) ? { ok: true } : { ok: false, reason: `Regex /${keyword}/ did not match` };
    } catch (e) {
      return { ok: false, reason: `Invalid regex: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  const has = body.includes(keyword);
  if (mode === "not_contains") return has ? { ok: false, reason: `Forbidden keyword "${keyword}" present` } : { ok: true };
  return has ? { ok: true } : { ok: false, reason: `Keyword "${keyword}" not found` };
}

async function checkHttp(m: Monitor): Promise<CheckResult> {
  const start = performance.now();
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
    assertSafeUrl(m.target);
    res = await fetch(m.target, init);
    elapsed = Math.round(performance.now() - start);
    statusCode = res.status;
  } catch (e) {
    elapsed = Math.round(performance.now() - start);
    const msg = e instanceof Error ? e.message : String(e);
    const isTlsErr = /certificate|tls|ssl/i.test(msg);
    if (ignoreTls && isTlsErr) {
      return { status: "degraded", response_time_ms: elapsed, status_code: null, error_message: `TLS error ignored: ${msg}`, cert_days_remaining: null };
    }
    return { status: "down", response_time_ms: elapsed, status_code: null, error_message: ctrl.signal.aborted ? "Timeout" : msg };
  } finally {
    clearTimeout(timer);
  }

  let codeOk = statusCodeMatches(statusCode, m.expected_status_codes);
  if (!followRedirects && !codeOk && statusCode >= 300 && statusCode < 400) codeOk = true;

  if (!codeOk) {
    try { await res.body?.cancel(); } catch (_) { /* noop */ }
    return { status: "down", response_time_ms: elapsed, status_code: statusCode, error_message: `Unexpected status code ${statusCode}` };
  }

  if (wantBody && m.keyword) {
    // Cap body at 1MB so a giant response can't OOM the worker.
    const MAX_BYTES = 1_048_576;
    let body = "";
    try {
      const reader = res.body?.getReader();
      if (reader) {
        const chunks: Uint8Array[] = [];
        let total = 0;
        // deno-lint-ignore no-constant-condition
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
  if (warnDays > 0 && m.target.startsWith("https://")) {
    certDays = await getCertDaysRemaining(m.target, Math.min(5000, m.timeout_seconds * 1000));
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

async function checkTcp(m: Monitor): Promise<CheckResult> {
  let host: string; let port: number;
  try { ({ host, port } = assertSafeHostPort(m.target)); }
  catch (e) { return { status: "down", response_time_ms: null, status_code: null, error_message: e instanceof Error ? e.message : String(e) }; }
  const start = performance.now();
  let conn: Deno.TcpConn | null = null;
  const timer = setTimeout(() => { try { conn?.close(); } catch (_) { /* noop */ } }, m.timeout_seconds * 1000);
  try {
    conn = await Deno.connect({ hostname: host, port, transport: "tcp" });
    return { status: "up", response_time_ms: Math.round(performance.now() - start), status_code: null, error_message: null };
  } catch (e) {
    return { status: "down", response_time_ms: Math.round(performance.now() - start), status_code: null, error_message: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
    try { conn?.close(); } catch (_) { /* noop */ }
  }
}

// "Ping" in the edge runtime: ICMP is not available from Deno workers, so we
// implement reachability as an HTTPS HEAD probe instead. Any 1xx-5xx response
// means the host answered. Label this clearly in the UI.
async function checkPing(m: Monitor): Promise<CheckResult> {
  const host = m.target.replace(/^https?:\/\//, "").split("/")[0];
  return await checkHttp({ ...m, target: `https://${host}`, expected_status_codes: "100-599", http_method: "HEAD", keyword: null });
}

async function checkDns(m: Monitor): Promise<CheckResult> {
  const start = performance.now();
  try {
    const host = m.target.replace(/^https?:\/\//, "").split("/")[0].split(":")[0];
    if (!host) throw new Error("Empty hostname");
    const recordType = (m.dns_record_type || "A").toUpperCase() as Deno.RecordType;
    const opts: Deno.ResolveDnsOptions = {};
    if (m.dns_resolver) {
      const [rh, rp] = m.dns_resolver.split(":");
      assertSafeHostname(rh);
      opts.nameServer = { ipAddr: rh, port: rp ? parseInt(rp, 10) : 53 };
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), m.timeout_seconds * 1000);
    let records: unknown[];
    try {
      records = await Deno.resolveDns(host, recordType, opts);
    } finally { clearTimeout(timer); }
    const elapsed = Math.round(performance.now() - start);
    if (!records?.length) {
      return { status: "down", response_time_ms: elapsed, status_code: null, error_message: "No DNS records returned" };
    }
    const expected = m.dns_expected_values ?? [];
    if (expected.length > 0) {
      const flat: string[] = records.map((r) => {
        if (typeof r === "string") return r;
        if (r && typeof r === "object") {
          const o = r as Record<string, unknown>;
          if ("exchange" in o) return String(o.exchange);
          if ("preference" in o && "exchange" in o) return String(o.exchange);
        }
        return JSON.stringify(r);
      });
      const missing = expected.filter((e) => !flat.some((f) => f.includes(e)));
      if (missing.length > 0) {
        return { status: "down", response_time_ms: elapsed, status_code: null, error_message: `Missing expected DNS values: ${missing.join(", ")}` };
      }
    }
    return { status: "up", response_time_ms: elapsed, status_code: null, error_message: null };
  } catch (e) {
    return { status: "down", response_time_ms: Math.round(performance.now() - start), status_code: null, error_message: e instanceof Error ? e.message : String(e) };
  }
}

function renderTemplate(tpl: string, ctx: Record<string, string>): string {
  return tpl.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, k) => ctx[k] ?? "");
}

function getJsonPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  const parts = path.replace(/^\$\.?/, "").split(".").filter(Boolean);
  let cur: unknown = obj;
  for (const p of parts) {
    const m = p.match(/^([^[]+)(?:\[(\d+)\])?$/);
    if (!m) return undefined;
    cur = (cur as Record<string, unknown>)?.[m[1]];
    if (m[2] != null && Array.isArray(cur)) cur = cur[parseInt(m[2], 10)];
  }
  return cur;
}

async function checkMultiStep(m: Monitor): Promise<CheckResult> {
  const start = performance.now();
  const steps = m.steps ?? [];
  if (!steps.length) return { status: "down", response_time_ms: 0, status_code: null, error_message: "No steps configured" };
  const ctx: Record<string, string> = {};
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const stepName = s.name || `Step ${i + 1}`;
    try {
      const url = renderTemplate(s.url, ctx);
      assertSafeUrl(url);
      const headers = new Headers({ "User-Agent": "LovableUptime/1.0" });
      for (const [k, v] of Object.entries(s.headers ?? {})) {
        headers.set(k, renderTemplate(v, ctx));
      }
      if (s.body && !headers.has("Content-Type")) {
        const ct = defaultContentType(s.body_type);
        if (ct) headers.set("Content-Type", ct);
      }
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), m.timeout_seconds * 1000);
      let res: Response;
      try {
        res = await fetch(url, {
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
        return { status: "down", response_time_ms: Math.round(performance.now() - start), status_code: res.status, error_message: `${stepName}: status ${res.status} not in ${expectedCodes}`, step_name: stepName };
      }
      const text = await res.text();
      let json: unknown = undefined;
      const needsJson = (s.extract?.some((e) => e.from === "json")) || (s.assert?.some((a) => a.from === "json"));
      if (needsJson) { try { json = JSON.parse(text); } catch (_) { /* not json */ } }
      // extract
      for (const ex of s.extract ?? []) {
        let val: unknown;
        if (ex.from === "header") val = res.headers.get(ex.path);
        else val = getJsonPath(json, ex.path);
        if (val != null) ctx[ex.name] = String(val);
      }
      // assert
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
        else if (a.op === "regex") { try { ok = new RegExp(expected).test(actual); } catch (_) { ok = false; } }
        if (!ok) {
          return { status: "down", response_time_ms: Math.round(performance.now() - start), status_code: res.status, error_message: `${stepName}: assert ${a.op} failed`, step_name: stepName };
        }
      }
    } catch (e) {
      return { status: "down", response_time_ms: Math.round(performance.now() - start), status_code: null, error_message: `${stepName}: ${e instanceof Error ? e.message : String(e)}`, step_name: stepName };
    }
  }
  const elapsed = Math.round(performance.now() - start);
  const threshold = m.degraded_threshold_ms ?? 0;
  if (threshold > 0 && elapsed > threshold) {
    return { status: "degraded", response_time_ms: elapsed, status_code: null, error_message: `Slow: ${elapsed}ms > ${threshold}ms` };
  }
  return { status: "up", response_time_ms: elapsed, status_code: null, error_message: null };
}

async function checkDatabase(m: Monitor): Promise<CheckResult> {
  const start = performance.now();
  if (!m.db_secret_name) return { status: "down", response_time_ms: 0, status_code: null, error_message: "Missing DSN secret name" };
  const dsn = Deno.env.get(m.db_secret_name);
  if (!dsn) return { status: "down", response_time_ms: 0, status_code: null, error_message: `Secret ${m.db_secret_name} not configured` };
  const kind = (m.db_kind || "postgres").toLowerCase();
  const query = m.db_query || "SELECT 1";
  try {
    const u = new URL(dsn);
    assertSafeHostname(u.hostname);
    if (kind === "postgres" || kind === "postgresql") {
      const { Client } = await import("https://deno.land/x/postgres@v0.19.3/mod.ts");
      const client = new Client(dsn);
      try {
        await client.connect();
        const r = await client.queryArray(query);
        const elapsed = Math.round(performance.now() - start);
        if (!r.rows?.length) return { status: "down", response_time_ms: elapsed, status_code: null, error_message: "Query returned no rows" };
        return { status: "up", response_time_ms: elapsed, status_code: null, error_message: null };
      } finally { try { await client.end(); } catch (_) { /* noop */ } }
    } else if (kind === "mysql") {
      const mod = await import("https://deno.land/x/mysql@v2.12.1/mod.ts");
      const client = await new mod.Client().connect({
        hostname: u.hostname, port: u.port ? parseInt(u.port, 10) : 3306,
        username: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
        db: u.pathname.replace(/^\//, ""),
      });
      try {
        const rows = await client.query(query);
        const elapsed = Math.round(performance.now() - start);
        if (!rows || (Array.isArray(rows) && rows.length === 0)) {
          return { status: "down", response_time_ms: elapsed, status_code: null, error_message: "Query returned no rows" };
        }
        return { status: "up", response_time_ms: elapsed, status_code: null, error_message: null };
      } finally { try { await client.close(); } catch (_) { /* noop */ } }
    }
    return { status: "down", response_time_ms: 0, status_code: null, error_message: `Unsupported db_kind: ${kind}` };
  } catch (e) {
    return { status: "down", response_time_ms: Math.round(performance.now() - start), status_code: null, error_message: e instanceof Error ? e.message : String(e) };
  }
}

function checkPush(m: Monitor): CheckResult {
  // Passive: status determined by whether last_checked_at is fresh.
  const grace = (m.push_grace_seconds ?? 60) * 1000;
  const interval = (m.interval_minutes ?? 5) * 60 * 1000;
  const last = m.last_checked_at ? Date.parse(m.last_checked_at) : 0;
  if (!last) return { status: "down", response_time_ms: null, status_code: null, error_message: "No heartbeat received yet" };
  const overdueBy = Date.now() - last - interval - grace;
  if (overdueBy > 0) {
    return { status: "down", response_time_ms: null, status_code: null, error_message: `Heartbeat overdue by ${Math.round(overdueBy / 1000)}s` };
  }
  return { status: "up", response_time_ms: null, status_code: null, error_message: null };
}

async function runOnce(m: Monitor): Promise<CheckResult> {
  switch (m.type) {
    case "http": return await checkHttp(m);
    case "tcp": return await checkTcp(m);
    case "ping": return await checkPing(m);
    case "dns": return await checkDns(m);
    case "multistep": return await checkMultiStep(m);
    case "database": return await checkDatabase(m);
    case "push": return checkPush(m);
  }
}

export async function runCheck(m: Monitor): Promise<CheckResult> {
  let result = await runOnce(m);
  const retries = Math.max(0, m.retry_count ?? 0);
  // Only retry hard down (not degraded). Push monitors don't retry.
  if (m.type === "push") return result;
  for (let i = 0; i < retries && result.status === "down"; i++) {
    await new Promise((r) => setTimeout(r, Math.max(0, (m.retry_interval_seconds ?? 20)) * 1000));
    result = await runOnce(m);
  }
  return result;
}
