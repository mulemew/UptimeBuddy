import { describe, it, expect } from "vitest";
import { runCheck } from "../src/checkers/index.js";
import type { Monitor, RuntimeCaps } from "../src/types.js";

function makeCaps(overrides: Partial<RuntimeCaps> = {}): RuntimeCaps {
  return {
    fetch: (async () => new Response("hi", { status: 200 })) as unknown as typeof fetch,
    tcpConnect: async () => 12,
    dnsResolve: async () => [{ value: "1.2.3.4" }],
    ...overrides,
  };
}

const base: Monitor = {
  id: "m1", name: "t", type: "http", target: "https://example.com",
  timeout_seconds: 5, keyword: null, keyword_match: null,
  expected_status_codes: "200-299",
};

describe("runCheck", () => {
  it("http up on 200", async () => {
    const r = await runCheck(base, makeCaps());
    expect(r.status).toBe("up");
    expect(r.status_code).toBe(200);
  });

  it("http down on unexpected status", async () => {
    const caps = makeCaps({ fetch: (async () => new Response("x", { status: 500 })) as unknown as typeof fetch });
    const r = await runCheck(base, caps);
    expect(r.status).toBe("down");
  });

  it("tcp up via injected connector", async () => {
    const r = await runCheck({ ...base, type: "tcp", target: "example.com:443" }, makeCaps());
    expect(r.status).toBe("up");
    expect(r.response_time_ms).toBe(12);
  });

  it("ping reports unavailable when icmpPing is missing", async () => {
    const r = await runCheck({ ...base, type: "ping", target: "example.com" }, makeCaps());
    expect(r.status).toBe("down");
    expect(r.error_message).toMatch(/ICMP ping is not available/);
  });

  it("ping up when icmpPing is present", async () => {
    const caps = makeCaps({ icmpPing: async () => ({ rttMs: 5.4 }) });
    const r = await runCheck({ ...base, type: "ping", target: "example.com" }, caps);
    expect(r.status).toBe("up");
    expect(r.response_time_ms).toBe(5);
  });
});
