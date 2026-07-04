// Cloudflare Workers capability injection.
//
// - HTTP: global fetch.
// - TCP: `cloudflare:sockets` connect() — L4 handshake latency.
// - DNS: Cloudflare DoH (1.1.1.1) JSON API — works from any Worker.
// - ICMP ping: NOT available. We omit the capability so the ping checker
//   returns a clear "unavailable in runtime" error to the user.
// - TLS cert expiry: skipped (no raw TLS handshake API in Workers).

import { connect } from "cloudflare:sockets";
import type { DnsAnswer, RuntimeCaps } from "@uptimebuddy/checker-core";

async function tcpConnect(host: string, port: number, timeoutMs: number): Promise<number> {
  const start = Date.now();
  const socket = connect({ hostname: host, port });
  const timer = new Promise<never>((_, rej) => setTimeout(() => rej(new Error("TCP connect timeout")), timeoutMs));
  try {
    await Promise.race([socket.opened, timer]);
    return Date.now() - start;
  } finally {
    try { await socket.close(); } catch { /* noop */ }
  }
}

// DoH record type codes we care about.
const DOH_TYPE: Record<string, number> = {
  A: 1, NS: 2, CNAME: 5, SOA: 6, PTR: 12, MX: 15, TXT: 16, AAAA: 28, SRV: 33, CAA: 257,
};

async function dnsResolve(host: string, type: string, timeoutMs: number, resolver?: string): Promise<DnsAnswer[]> {
  const t = DOH_TYPE[type.toUpperCase()] ?? 1;
  const base = resolver ? `https://${resolver.split(":")[0]}/dns-query` : "https://cloudflare-dns.com/dns-query";
  const url = `${base}?name=${encodeURIComponent(host)}&type=${t}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { accept: "application/dns-json" }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`DoH ${res.status}`);
    const json = await res.json() as { Answer?: { data: string; type: number }[] };
    return (json.Answer ?? []).map((a) => ({ value: a.data }));
  } finally { clearTimeout(timer); }
}

export const caps: RuntimeCaps = {
  fetch: globalThis.fetch.bind(globalThis),
  tcpConnect,
  dnsResolve,
  // icmpPing intentionally omitted — CF Workers cannot open raw sockets.
};
