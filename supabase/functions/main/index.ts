// Main router function for the self-hosted edge runtime.
// Receives every request and forwards it to the matching user function
// based on the first URL path segment.
import { STATUS_CODE } from "https://deno.land/std@0.224.0/http/status.ts";

console.log("UptimeBuddy edge runtime booted");

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/+/, "");
  const [name, ...rest] = path.split("/");

  if (!name) {
    return new Response(JSON.stringify({ error: "Function name required" }), {
      status: STATUS_CODE.BadRequest,
      headers: { "content-type": "application/json" },
    });
  }

  const servicePath = `/home/deno/functions/${name}`;
  // Whitelist only env vars functions actually need — don't leak
  // POSTGRES_PASSWORD / JWT_SECRET / etc. to every user worker.
  const ALLOWED_ENV = [
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_DB_URL",
  ];
  const envVars: [string, string][] = ALLOWED_ENV
    .map((k) => [k, Deno.env.get(k) ?? ""] as [string, string])
    .filter(([, v]) => v.length > 0);
  try {
    // @ts-expect-error: EdgeRuntime is injected by the supabase/edge-runtime image
    const worker = await EdgeRuntime.userWorkers.create({
      servicePath,
      memoryLimitMb: 256,
      workerTimeoutMs: 60_000,
      noModuleCache: false,
      envVars,
    });
    const forwarded = new Request(
      new URL("/" + rest.join("/") + url.search, url.origin),
      req,
    );
    return await worker.fetch(forwarded);
  } catch (e) {
    console.error("Function dispatch error", name, e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }
});
