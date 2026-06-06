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
  if (a === 0) return true;                                // 0.0.0.0/8
  if (a === 169 && b === 254) return true;                 // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // IETF / TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return true;      // 6to4 anycast (reserved)
  if (a === 198 && (b === 18 || b === 19)) return true;    // benchmark
  if (a === 198 && b === 51 && c === 100) return true;     // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true;      // TEST-NET-3
  if (a === 100 && b >= 64 && b <= 127) return true;       // CGNAT
  if (a >= 224) return true;                               // multicast / reserved / broadcast
  return false;
}

// Parse a (possibly compressed) IPv6 literal into 8 16-bit groups.
// Returns null if the input is not a syntactically valid IPv6 address.
function parseIPv6(ip: string): number[] | null {
  // Strip zone id (e.g. fe80::1%eth0)
  const noZone = ip.split("%")[0];
  // Handle embedded IPv4 (e.g. ::ffff:1.2.3.4 or 64:ff9b::1.2.3.4)
  let head = noZone;
  let tailV4: number[] | null = null;
  const v4m = noZone.match(/(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4m) {
    head = v4m[1].replace(/:$/, "") || "::";
    const parts = v4m[2].split(".").map((n) => parseInt(n, 10));
    if (parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return null;
    tailV4 = [(parts[0] << 8) | parts[1], (parts[2] << 8) | parts[3]];
  }
  const dbl = head.split("::");
  if (dbl.length > 2) return null;
  const toGroups = (s: string) => (s === "" ? [] : s.split(":").map((g) => {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return NaN;
    return parseInt(g, 16);
  }));
  const left = toGroups(dbl[0] ?? "");
  const right = dbl.length === 2 ? toGroups(dbl[1]) : [];
  if ([...left, ...right].some((n) => Number.isNaN(n))) return null;
  const tail = tailV4 ? [...right, ...tailV4] : right;
  const total = left.length + tail.length;
  if (dbl.length === 2) {
    if (total > 8) return null;
    const zeros = new Array(8 - total).fill(0);
    return [...left, ...zeros, ...tail];
  }
  if (total !== 8) return null;
  return [...left, ...tail];
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase().replace(/^\[|\]$/g, "");
  const groups = parseIPv6(lower);
  if (!groups) {
    // Unparseable — fail closed.
    return true;
  }
  // Unspecified ::
  if (groups.every((g) => g === 0)) return true;
  // Loopback ::1
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return true;
  // Multicast ff00::/8
  if ((groups[0] & 0xff00) === 0xff00) return true;
  // Link-local fe80::/10
  if ((groups[0] & 0xffc0) === 0xfe80) return true;
  // Unique local fc00::/7
  if ((groups[0] & 0xfe00) === 0xfc00) return true;
  // Discard 100::/64
  if (groups[0] === 0x0100 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0) return true;
  // IPv4-mapped ::ffff:a.b.c.d
  if (groups[0] === 0 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0 &&
      groups[4] === 0 && groups[5] === 0xffff) {
    const v4 = `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`;
    return isPrivateIPv4(v4);
  }
  // IPv4-compatible ::a.b.c.d (deprecated, treat as private if inner is private)
  if (groups.slice(0, 6).every((g) => g === 0) && (groups[6] !== 0 || groups[7] !== 0)) {
    const v4 = `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`;
    if (isPrivateIPv4(v4)) return true;
  }
  // NAT64 well-known prefix 64:ff9b::/96 and 64:ff9b:1::/48
  if (groups[0] === 0x0064 && groups[1] === 0xff9b) {
    const v4 = `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`;
    if (isPrivateIPv4(v4)) return true;
  }
  // 6to4 2002::/16 — extract embedded v4 and recheck
  if (groups[0] === 0x2002) {
    const v4 = `${groups[1] >> 8}.${groups[1] & 0xff}.${groups[2] >> 8}.${groups[2] & 0xff}`;
    if (isPrivateIPv4(v4)) return true;
  }
  // Documentation 2001:db8::/32
  if (groups[0] === 0x2001 && groups[1] === 0x0db8) return true;
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
