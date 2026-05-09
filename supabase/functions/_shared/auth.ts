import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

let _client: SupabaseClient | null = null;
export function serviceClient(): SupabaseClient {
  if (!_client) {
    _client = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
  }
  return _client;
}

export async function verifySessionToken(token: string | null | undefined): Promise<boolean> {
  if (!token) return false;
  const sb = serviceClient();
  const { data } = await sb
    .from("admin_sessions")
    .select("token, expires_at")
    .eq("token", token)
    .maybeSingle();
  if (!data) return false;
  if (new Date(data.expires_at).getTime() < Date.now()) {
    await sb.from("admin_sessions").delete().eq("token", token);
    return false;
  }
  return true;
}
