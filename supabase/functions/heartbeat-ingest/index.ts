// Public webhook ingest for push (passive heartbeat) monitors.
import { adminClient } from "../_shared/persist.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const url = new URL(req.url);
    let token = url.searchParams.get("token") ?? "";
    let status = (url.searchParams.get("status") ?? "up").toLowerCase();
    let msg = url.searchParams.get("msg") ?? null;
    let ms: number | null = null;
    const msRaw = url.searchParams.get("ms");
    if (msRaw) ms = parseInt(msRaw, 10);

    if (req.method === "POST" && (req.headers.get("content-type") || "").includes("application/json")) {
      const body = await req.json().catch(() => ({}));
      if (body.token) token = String(body.token);
      if (body.status) status = String(body.status).toLowerCase();
      if (body.msg) msg = String(body.msg);
      if (typeof body.ms === "number") ms = body.ms;
    }
    if (!token) return new Response(JSON.stringify({ error: "Missing token" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const sb = adminClient();
    const { data: monitor } = await sb.from("monitors").select("id,last_status").eq("push_token", token).maybeSingle();
    if (!monitor) return new Response(JSON.stringify({ error: "Invalid token" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const finalStatus = status === "down" ? "down" : status === "degraded" ? "degraded" : "up";
    const checkedAt = new Date().toISOString();

    await sb.from("heartbeats").insert({
      monitor_id: monitor.id,
      checked_at: checkedAt,
      status: finalStatus,
      response_time_ms: ms,
      status_code: null,
      error_message: msg,
    });

    await sb.from("monitors").update({
      last_checked_at: checkedAt,
      last_status: finalStatus,
    }).eq("id", monitor.id);

    if (monitor.last_status !== "down" && finalStatus === "down") {
      await sb.from("incidents").insert({ monitor_id: monitor.id, started_at: checkedAt, reason: msg ?? "Push reported down" });
    } else if (monitor.last_status === "down" && finalStatus !== "down") {
      const { data: open } = await sb.from("incidents").select("id, started_at").eq("monitor_id", monitor.id).is("ended_at", null).order("started_at", { ascending: false }).limit(1).maybeSingle();
      if (open) {
        const duration = Math.round((Date.parse(checkedAt) - Date.parse(open.started_at)) / 1000);
        await sb.from("incidents").update({ ended_at: checkedAt, duration_seconds: duration }).eq("id", open.id);
      }
    }

    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
