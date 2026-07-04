// Runtime-agnostic types. Zero imports so this file compiles in Deno, Node,
// Cloudflare Workers and the browser identically.

export type MonitorType = "http" | "tcp" | "ping" | "dns" | "multistep" | "database" | "push";
export type MatchMode = "contains" | "not_contains" | "regex";
export type CheckStatus = "up" | "down" | "degraded";

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
  dns_record_type?: string | null;
  dns_resolver?: string | null;
  dns_expected_values?: string[] | null;
  steps?: MonitorStep[];
  db_kind?: string | null;
  db_secret_name?: string | null;
  db_query?: string | null;
  push_token?: string | null;
  push_grace_seconds?: number;
  interval_minutes?: number;
  last_checked_at?: string | null;
  last_status?: string | null;
  enabled?: boolean;
}

export interface CheckResult {
  status: CheckStatus;
  response_time_ms: number | null;
  status_code: number | null;
  error_message: string | null;
  cert_days_remaining?: number | null;
  step_name?: string | null;
}

// ---------- Runtime capabilities ---------------------------------------------
// The core never touches a runtime API directly; adapters inject whatever they
// support. Omit a capability => corresponding checker returns a clean error.

export interface DnsAnswer {
  value: string;
  // for MX records
  preference?: number;
}

export interface RuntimeCaps {
  // Global HTTP fetch. In every supported runtime this is just `globalThis.fetch`.
  fetch: typeof fetch;

  // Open a TCP connection to host:port and return the handshake RTT in ms.
  // Reject on timeout / failure. Must NOT throw synchronously.
  tcpConnect(host: string, port: number, timeoutMs: number): Promise<number>;

  // Real ICMP ping. Optional — CF Workers can't do raw sockets, so they don't
  // implement this and the ping checker will report "unavailable in runtime".
  icmpPing?(host: string, timeoutMs: number): Promise<{ rttMs: number }>;

  // Resolve DNS. `type` is one of A / AAAA / MX / TXT / CNAME / NS.
  // `resolver` is "host" or "host:port" (optional).
  dnsResolve(host: string, type: string, timeoutMs: number, resolver?: string): Promise<DnsAnswer[]>;

  // TLS peer certificate expiry (days until notAfter). Optional; when missing
  // the cert-expiry warning is silently skipped.
  tlsCertDaysRemaining?(host: string, port: number, timeoutMs: number): Promise<number | null>;

  // SSRF guards. Adapters may inject stricter versions; a permissive default
  // is provided if omitted (URL parse only).
  assertSafeUrl?(url: string): void;
  assertSafeHostPort?(target: string): { host: string; port: number };
  assertSafeHostname?(host: string): void;

  // Wall clock — injectable for tests.
  now?(): number;
}
