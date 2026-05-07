import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const SESSION_TTL_DAYS = 30;

async function hashPassword(password: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(password + ":" + salt);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomToken(bytes = 32): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function validateUsername(u: unknown): u is string {
  return typeof u === "string" && u.trim().length >= 3 && u.trim().length <= 64;
}
function validatePassword(p: unknown): p is string {
  return typeof p === "string" && p.length >= 8 && p.length <= 128;
}

async function getAdmin() {
  const { data } = await supabase.from("admin_account").select("*").maybeSingle();
  return data;
}

async function verifyToken(token: string | null) {
  if (!token) return false;
  const { data } = await supabase
    .from("admin_sessions")
    .select("token, expires_at")
    .eq("token", token)
    .maybeSingle();
  if (!data) return false;
  if (new Date(data.expires_at).getTime() < Date.now()) {
    await supabase.from("admin_sessions").delete().eq("token", token);
    return false;
  }
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action as string;
    const token = req.headers.get("x-session-token");

    if (action === "status") {
      const admin = await getAdmin();
      const authed = await verifyToken(token);
      return json({
        initialized: !!admin,
        authenticated: authed,
        username: admin?.username ?? null,
        public_status_page: admin?.public_status_page ?? true,
      });
    }

    if (action === "update-settings") {
      if (!await verifyToken(token)) return json({ error: "未授权" }, 401);
      const admin = await getAdmin();
      if (!admin) return json({ error: "尚未初始化" }, 400);
      const { public_status_page } = body;
      if (typeof public_status_page !== "boolean") return json({ error: "参数错误" }, 400);
      const { error } = await supabase
        .from("admin_account")
        .update({ public_status_page })
        .eq("id", admin.id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, public_status_page });
    }

    if (action === "setup") {
      const existing = await getAdmin();
      if (existing) return json({ error: "已初始化" }, 409);
      const { username, password } = body;
      if (!validateUsername(username)) return json({ error: "用户名长度需为 3-64" }, 400);
      if (!validatePassword(password)) return json({ error: "密码长度至少 8 位" }, 400);
      const salt = randomToken(16);
      const hash = await hashPassword(password, salt);
      const { error } = await supabase.from("admin_account").insert({
        username: username.trim(),
        password_hash: hash,
        password_salt: salt,
      });
      if (error) return json({ error: error.message }, 500);
      const newToken = randomToken();
      const expires = new Date(Date.now() + SESSION_TTL_DAYS * 86400_000).toISOString();
      await supabase.from("admin_sessions").insert({ token: newToken, expires_at: expires });
      return json({ token: newToken, username: username.trim() });
    }

    if (action === "login") {
      const admin = await getAdmin();
      if (!admin) return json({ error: "尚未初始化" }, 400);
      const { username, password } = body;
      if (typeof username !== "string" || typeof password !== "string") return json({ error: "缺少参数" }, 400);
      const hash = await hashPassword(password, admin.password_salt);
      if (username.trim() !== admin.username || hash !== admin.password_hash) {
        return json({ error: "用户名或密码错误" }, 401);
      }
      const newToken = randomToken();
      const expires = new Date(Date.now() + SESSION_TTL_DAYS * 86400_000).toISOString();
      await supabase.from("admin_sessions").insert({ token: newToken, expires_at: expires });
      return json({ token: newToken, username: admin.username });
    }

    if (action === "logout") {
      if (token) await supabase.from("admin_sessions").delete().eq("token", token);
      return json({ ok: true });
    }

    if (action === "change-credentials") {
      if (!await verifyToken(token)) return json({ error: "未授权" }, 401);
      const admin = await getAdmin();
      if (!admin) return json({ error: "尚未初始化" }, 400);
      const { current_password, new_username, new_password } = body;
      if (typeof current_password !== "string") return json({ error: "缺少当前密码" }, 400);
      const curHash = await hashPassword(current_password, admin.password_salt);
      if (curHash !== admin.password_hash) return json({ error: "当前密码错误" }, 401);

      const update: Record<string, string> = {};
      if (new_username !== undefined && new_username !== admin.username) {
        if (!validateUsername(new_username)) return json({ error: "用户名长度需为 3-64" }, 400);
        update.username = (new_username as string).trim();
      }
      if (new_password) {
        if (!validatePassword(new_password)) return json({ error: "新密码长度至少 8 位" }, 400);
        const salt = randomToken(16);
        update.password_salt = salt;
        update.password_hash = await hashPassword(new_password, salt);
      }
      if (Object.keys(update).length === 0) return json({ ok: true });
      const { error } = await supabase.from("admin_account").update(update).eq("id", admin.id);
      if (error) return json({ error: error.message }, 500);
      // If password changed, invalidate other sessions
      if (update.password_hash) {
        await supabase.from("admin_sessions").delete().neq("token", token ?? "");
      }
      return json({ ok: true, username: update.username ?? admin.username });
    }

    return json({ error: "未知操作" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
