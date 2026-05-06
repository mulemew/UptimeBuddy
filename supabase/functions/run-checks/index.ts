import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { adminClient, persistResult } from "../_shared/persist.ts";
import { runCheck, type Monitor } from "../_shared/checkers.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const sb = adminClient();
    const nowIso = new Date().toISOString();

    const { data: monitors, error } = await sb
      .from("monitors")
      .select("id,name,type,target,interval_minutes,timeout_seconds,keyword,keyword_match,expected_status_codes,last_checked_at,last_status,http_method,http_body,http_body_type,http_headers,follow_redirects,ignore_tls_errors,cert_expiry_warn_days,match_mode,degraded_threshold_ms")
      .eq("enabled", true);

    if (error) throw error;

    const due = (monitors ?? []).filter((m) => {
      if (!m.last_checked_at) return true;
      const next = Date.parse(m.last_checked_at) + m.interval_minutes * 60 * 1000;
      return Date.now() >= next - 5_000; // 5s slack
    });

    const results = await Promise.allSettled(
      due.map(async (m) => {
        const result = await runCheck(m as Monitor);
        await persistResult(sb, m as Monitor & { last_status: string }, result);
        return { id: m.id, status: result.status };
      }),
    );

    return new Response(
      JSON.stringify({
        now: nowIso,
        total: monitors?.length ?? 0,
        checked: due.length,
        results: results.map((r) => r.status === "fulfilled" ? r.value : { error: String(r.reason) }),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
