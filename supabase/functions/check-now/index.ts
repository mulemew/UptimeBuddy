import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { z } from "https://esm.sh/zod@3.23.8";
import { adminClient, persistResult } from "../_shared/persist.ts";
import { runCheck, type Monitor } from "../_shared/checkers.ts";

const BodySchema = z.object({ monitor_id: z.string().uuid() });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: parsed.error.flatten().fieldErrors }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sb = adminClient();
    const { data: monitor, error } = await sb
      .from("monitors")
      .select("id,name,type,target,interval_minutes,timeout_seconds,keyword,keyword_match,expected_status_codes,last_status")
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
