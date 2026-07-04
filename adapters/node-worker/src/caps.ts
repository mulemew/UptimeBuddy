// Node.js capability injection. Runs inside the node-worker Docker container.
//
// - TCP: `net.Socket` with a hard timeout.
// - ICMP ping: spawn /bin/ping (available in the container; setcap grants NET_RAW).
// - DNS: `dns/promises` with optional custom resolver.
// - TLS cert expiry: `tls.connect()` peer certificate.

import net from "node:net";
import tls from "node:tls";
import { promises as dns, Resolver } from "node:dns";
import { spawn } from "node:child_process";
import type { DnsAnswer, RuntimeCaps } from "@uptimebuddy/checker-core";

function tcpConnect(host: string, port: number, timeoutMs: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const sock = new net.Socket();
    const done = (err?: Error) => {
      try { sock.destroy(); } catch { /* noop */ }
      if (err) reject(err); else resolve(Date.now() - start);
    };
    sock.setTimeout(timeoutMs, () => done(new Error("TCP connect timeout")));
    sock.once("error", (e) => done(e));
    sock.connect(port, host, () => done());
  });
}

function icmpPing(host: string, timeoutMs: number): Promise<{ rttMs: number }> {
  return new Promise((resolve, reject) => {
    const isV6 = host.includes(":");
    const bin = isV6 ? "ping6" : "ping";
    const tSec = Math.max(1, Math.ceil(timeoutMs / 1000));
    const proc = spawn(bin, ["-c", "1", "-W", String(tSec), "-n", "-q", host]);
    let out = "", err = "";
    proc.stdout.on("data", (b) => (out += b.toString()));
    proc.stderr.on("data", (b) => (err += b.toString()));
    const killer = setTimeout(() => { try { proc.kill("SIGKILL"); } catch { /* noop */ } }, timeoutMs + 2000);
    proc.on("close", (code) => {
      clearTimeout(killer);
      if (code !== 0) {
        const msg = err.trim() || out.split("\n").filter(Boolean).slice(-1)[0] || `exit ${code}`;
        return reject(new Error(msg));
      }
      const m = out.match(/=\s*[\d.]+\/([\d.]+)\/[\d.]+\/[\d.]+\s*ms/);
      resolve({ rttMs: m ? parseFloat(m[1]) : 0 });
    });
    proc.on("error", (e) => { clearTimeout(killer); reject(e); });
  });
}

async function dnsResolve(host: string, type: string, timeoutMs: number, resolver?: string): Promise<DnsAnswer[]> {
  const t = type.toUpperCase();
  const resolveFn = async () => {
    if (resolver) {
      const r = new Resolver();
      const [rh, rp] = resolver.split(":");
      r.setServers([rp ? `${rh}:${parseInt(rp, 10)}` : rh]);
      // @ts-expect-error node types missing resolve(type)
      return await r.resolve(host, t);
    }
    // @ts-expect-error node types missing resolve(type)
    return await dns.resolve(host, t);
  };
  const to = new Promise<never>((_, rej) => setTimeout(() => rej(new Error("DNS timeout")), timeoutMs));
  const raw = await Promise.race([resolveFn(), to]) as unknown[];
  return raw.map((r): DnsAnswer => {
    if (typeof r === "string") return { value: r };
    if (r && typeof r === "object" && "exchange" in (r as Record<string, unknown>)) {
      const o = r as { exchange: string; priority?: number };
      return { value: o.exchange, preference: o.priority };
    }
    return { value: JSON.stringify(r) };
  });
}

function tlsCertDaysRemaining(host: string, port: number, timeoutMs: number): Promise<number | null> {
  return new Promise((resolve) => {
    const sock = tls.connect({ host, port, servername: host, rejectUnauthorized: false }, () => {
      const cert = sock.getPeerCertificate();
      try { sock.destroy(); } catch { /* noop */ }
      if (!cert?.valid_to) return resolve(null);
      resolve(Math.floor((Date.parse(cert.valid_to) - Date.now()) / 86_400_000));
    });
    sock.setTimeout(timeoutMs, () => { try { sock.destroy(); } catch { /* noop */ } resolve(null); });
    sock.once("error", () => resolve(null));
  });
}

export const caps: RuntimeCaps = {
  fetch: globalThis.fetch,
  tcpConnect,
  icmpPing,
  dnsResolve,
  tlsCertDaysRemaining,
};
