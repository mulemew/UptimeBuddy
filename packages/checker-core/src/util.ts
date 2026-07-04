import type { MatchMode } from "./types.js";

export function statusCodeMatches(code: number, spec: string): boolean {
  return spec.split(",").map((s) => s.trim()).filter(Boolean).some((part) => {
    if (part.includes("-")) {
      const [a, b] = part.split("-").map((x) => parseInt(x, 10));
      return code >= a && code <= b;
    }
    return parseInt(part, 10) === code;
  });
}

export function defaultContentType(bodyType?: string | null): string | null {
  switch (bodyType) {
    case "json": return "application/json";
    case "xml": return "application/xml";
    case "form": return "application/x-www-form-urlencoded";
    case "text": return "text/plain";
    default: return null;
  }
}

export function evaluateMatch(body: string, keyword: string, mode: MatchMode): { ok: boolean; reason?: string } {
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

export function renderTemplate(tpl: string, ctx: Record<string, string>): string {
  return tpl.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, k) => ctx[k] ?? "");
}

export function getJsonPath(obj: unknown, path: string): unknown {
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

// Best-effort URL safety. Adapters can override with a real SSRF guard.
export function defaultAssertSafeUrl(url: string): void {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol)) throw new Error(`Unsupported protocol: ${u.protocol}`);
}

export function defaultAssertSafeHostPort(target: string): { host: string; port: number } {
  const m = target.match(/^\[?([^\]]+)\]?:(\d+)$/) || target.match(/^([^:]+):(\d+)$/);
  if (!m) throw new Error(`Invalid host:port "${target}"`);
  const port = parseInt(m[2], 10);
  if (!(port > 0 && port < 65536)) throw new Error(`Invalid port ${port}`);
  return { host: m[1], port };
}

export function defaultAssertSafeHostname(host: string): void {
  if (!host || /[\s]/.test(host)) throw new Error(`Invalid hostname "${host}"`);
}
