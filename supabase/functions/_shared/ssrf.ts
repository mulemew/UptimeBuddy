// SSRF guards for outbound monitor checks.
// Blocks private/loopback/link-local/metadata addresses.

const BLOCKED_HOSTNAMES = new Set([
  "localhost", "ip6-localhost", "ip6-loopback",
  "metadata.google.internal",
]);

function isPrivateIPv4(ip: string): boolean {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b, c, d] = m.slice(1).map((n) => parseInt(n, 10));
  if ([a, b, c, d].some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
  if (a === 10) return true;
  if (a === 127) return true;                              // loopback
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;                 // link-local / AWS metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;       // CGNAT
  if (a >= 224) return true;                               // multicast / reserved
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (lower.startsWith("ff")) return true; // multicast
  // IPv4-mapped (::ffff:a.b.c.d)
  const m = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (m && isPrivateIPv4(m[1])) return true;
  return false;
}

export function assertSafeHostname(hostname: string): void {
  const h = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!h) throw new Error("Empty hostname");
  if (BLOCKED_HOSTNAMES.has(h)) throw new Error("Hostname is blocked");
  if (h.endsWith(".local") || h.endsWith(".internal")) throw new Error("Hostname is blocked");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
    if (isPrivateIPv4(h)) throw new Error("Private/reserved IPv4 address is blocked");
  } else if (h.includes(":")) {
    if (isPrivateIPv6(h)) throw new Error("Private/reserved IPv6 address is blocked");
  }
}

export function assertSafeUrl(target: string): URL {
  let u: URL;
  try { u = new URL(target); } catch { throw new Error("Invalid URL"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("Only http/https URLs are allowed");
  }
  assertSafeHostname(u.hostname);
  return u;
}

export function assertSafeHostPort(target: string): { host: string; port: number } {
  const idx = target.lastIndexOf(":");
  if (idx <= 0) throw new Error("Invalid target, expected host:port");
  const host = target.slice(0, idx).replace(/^\[|\]$/g, "");
  const port = parseInt(target.slice(idx + 1), 10);
  if (!host || !port || port < 1 || port > 65535) throw new Error("Invalid target, expected host:port");
  assertSafeHostname(host);
  return { host, port };
}
