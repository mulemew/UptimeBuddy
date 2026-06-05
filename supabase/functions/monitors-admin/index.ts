import { z } from "https://esm.sh/zod@3.23.8";
import { serviceClient, verifySessionToken } from "../_shared/auth.ts";
import { assertSafeUrl, assertSafeHostPort, assertSafeHostname } from "../_shared/ssrf.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-session-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const HeadersRecord = z.record(z.string(), z.string().max(4000));
const StepSchema = z.object({
  name: z.string().max(120).optional(),
  method: z.string().max(10).optional(),
  url: z.string().min(1).max(2000),
  headers: HeadersRecord.optional(),
  body: z.string().max(64_000).nullable().optional(),
  body_type: z.string().max(20).nullable().optional(),
  expected_status_codes: z.string().max(200).optional(),
  extract: z.array(z.object({ name: z.string().max(60), from: z.enum(["json", "header"]), path: z.string().max(500) })).max(20).optional(),
  assert: z.array(z.object({ from: z.enum(["json", "body", "header"]).optional(), path: z.string().max(500).optional(), op: z.enum(["eq", "contains", "regex"]), value: z.string().max(2000) })).max(20).optional(),
});

const MonitorPayload = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(["http", "tcp", "ping", "dns", "multistep", "database", "push"]),
  target: z.string().max(2000).optional().default(""),
  interval_minutes: z.number().int().min(1).max(1440),
  timeout_seconds: z.number().int().min(1).max(60),
  expected_status_codes: z.string().min(1).max(200).optional().default("200-299,300-399"),
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
  retry_count: z.number().int().min(0).max(10).optional(),
  retry_interval_seconds: z.number().int().min(1).max(600).optional(),
  dns_record_type: z.enum(["A", "AAAA", "CNAME", "MX", "TXT", "NS"]).nullable().optional(),
  dns_resolver: z.string().max(200).nullable().optional(),
  dns_expected_values: z.array(z.string().max(500)).max(20).nullable().optional(),
  steps: z.array(StepSchema).max(20).optional(),
  db_kind: z.enum(["postgres", "mysql"]).nullable().optional(),
  // DSN secrets must use the MON_ prefix so the edge router can safely forward
  // them to worker functions (see supabase/functions/main/index.ts).
  db_secret_name: z.string().regex(/^MON_[A-Z0-9_]+$/, "Must match MON_[A-Z0-9_]+").max(120).nullable().optional(),
  db_query: z.string().max(2000).nullable().optional(),
  push_grace_seconds: z.number().int().min(5).max(86400).optional(),
});

const MaintenancePayload = z.object({
  monitor_id: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(200),
  starts_at: z.string(),
  ends_at: z.string(),
  recurrence: z.enum(["none", "daily", "weekly"]).default("none"),
  weekday: z.number().int().min(0).max(6).nullable().optional(),
});

function validateTarget(type: string, target: string) {
  try {
    if (!target) {
      if (type === "multistep" || type === "database" || type === "push") return;
    }
    if (type === "tcp") assertSafeHostPort(target);
    else if (type === "http") assertSafeUrl(target);
    else if (type === "ping" || type === "dns") {
      const host = target.replace(/^https?:\/\//, "").split("/")[0].split(":")[0];
      assertSafeHostname(host);
    }
  } catch (e) {
    throw new Error(`Invalid target: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function genToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
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
      const data = { ...parsed.data } as Record<string, unknown>;
      if (action === "create") {
        if (parsed.data.type === "push") data.push_token = genToken();
        const { data: row, error } = await sb.from("monitors").insert(data as never).select("id, push_token").single();
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true, id: row.id, push_token: row.push_token });
      } else {
        const id = body.id as string;
        if (!id) return json({ error: "Missing id" }, 400);
        const { error } = await sb.from("monitors").update(data as never).eq("id", id);
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

    if (action === "regen_token") {
      const id = body.id as string;
      if (!id) return json({ error: "Missing id" }, 400);
      const t = genToken();
      const { error } = await sb.from("monitors").update({ push_token: t }).eq("id", id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, push_token: t });
    }

    if (action === "maintenance.list") {
      const { data, error } = await sb.from("maintenance_windows").select("*").order("starts_at", { ascending: false });
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, items: data });
    }

    if (action === "maintenance.create" || action === "maintenance.update") {
      const parsed = MaintenancePayload.safeParse(body.payload);
      if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);
      if (action === "maintenance.create") {
        const { data, error } = await sb.from("maintenance_windows").insert(parsed.data as never).select("id").single();
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true, id: data.id });
      } else {
        const id = body.id as string;
        if (!id) return json({ error: "Missing id" }, 400);
        const { error } = await sb.from("maintenance_windows").update(parsed.data as never).eq("id", id);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }
    }

    if (action === "maintenance.delete") {
      const id = body.id as string;
      if (!id) return json({ error: "Missing id" }, 400);
      const { error } = await sb.from("maintenance_windows").delete().eq("id", id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
