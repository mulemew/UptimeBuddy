import { z } from "https://esm.sh/zod@3.23.8";
import { adminClient, persistResult } from "../_shared/persist.ts";
import { runCheck, type Monitor } from "../_shared/checkers.ts";
import { verifySessionToken } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-session-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BodySchema = z.object({ monitor_id: z.string().uuid() });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const token = req.headers.get("x-session-token");
    if (!(await verifySessionToken(token))) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: parsed.error.flatten().fieldErrors }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sb = adminClient();
    const { data: monitor, error } = await sb
      .from("monitors")
      .select("id,name,type,target,interval_minutes,timeout_seconds,keyword,keyword_match,expected_status_codes,last_status,http_method,http_body,http_body_type,http_headers,follow_redirects,ignore_tls_errors,cert_expiry_warn_days,match_mode,degraded_threshold_ms")
      .eq("id", parsed.data.monitor_id)
      .maybeSingle();

    if (error || !monitor) {
      return new Response(JSON.stringify({ error: "Monitor not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await runCheck(monitor as Monitor);
    await persistResult(sb, monitor as Monitor & { last_status: string }, result);

    return new Response(JSON.stringify({ ok: true, result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
