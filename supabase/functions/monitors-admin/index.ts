import { z } from "https://esm.sh/zod@3.23.8";
import { serviceClient, verifySessionToken } from "../_shared/auth.ts";
import { assertSafeUrl, assertSafeHostPort } from "../_shared/ssrf.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-session-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const HeadersRecord = z.record(z.string(), z.string().max(4000));
const MonitorPayload = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(["http", "tcp", "ping"]),
  target: z.string().min(1).max(2000),
  interval_minutes: z.number().int().min(1).max(1440),
  timeout_seconds: z.number().int().min(1).max(60),
  expected_status_codes: z.string().min(1).max(200),
  keyword: z.string().max(2000).nullable().optional(),
  match_mode: z.enum(["contains", "not_contains", "regex"]).optional(),
  keyword_match: z.enum(["contains", "not_contains"]).optional(),
  http_method: z.string().max(10).optional(),
  http_body: z.string().max(64_000).nullable().optional(),
  http_body_type: z.string().max(20).nullable().optional(),
  http_headers: HeadersRecord.optional(),
  follow_redirects: z.boolean().optional(),
  ignore_tls_errors: z.boolean().optional(),
  cert_expiry_warn_days: z.number().int().min(0).max(365).optional(),
  degraded_threshold_ms: z.number().int().min(0).max(120_000).nullable().optional(),
});

function validateTarget(type: string, target: string) {
  try {
    if (type === "tcp") assertSafeHostPort(target);
    else if (type === "http") assertSafeUrl(target);
    else if (type === "ping") {
      const host = target.replace(/^https?:\/\//, "").split("/")[0];
      assertSafeUrl(`https://${host}`);
    }
  } catch (e) {
    throw new Error(`Invalid target: ${e instanceof Error ? e.message : String(e)}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const token = req.headers.get("x-session-token");
    if (!(await verifySessionToken(token))) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const action = body.action as string;
    const sb = serviceClient();

    if (action === "create" || action === "update") {
      const parsed = MonitorPayload.safeParse(body.payload);
      if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);
      validateTarget(parsed.data.type, parsed.data.target);
      if (action === "create") {
        const { data, error } = await sb.from("monitors").insert(parsed.data as never).select("id").single();
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true, id: data.id });
      } else {
        const id = body.id as string;
        if (!id) return json({ error: "Missing id" }, 400);
        const { error } = await sb.from("monitors").update(parsed.data as never).eq("id", id);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }
    }

    if (action === "delete") {
      const id = body.id as string;
      if (!id) return json({ error: "Missing id" }, 400);
      const { error } = await sb.from("monitors").delete().eq("id", id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    if (action === "toggle") {
      const id = body.id as string;
      const enabled = body.enabled;
      if (!id || typeof enabled !== "boolean") return json({ error: "Bad params" }, 400);
      const { error } = await sb.from("monitors").update({ enabled }).eq("id", id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
