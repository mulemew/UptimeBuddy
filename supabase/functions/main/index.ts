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
  try {
    // @ts-expect-error: EdgeRuntime is injected by the supabase/edge-runtime image
    const worker = await EdgeRuntime.userWorkers.create({
      servicePath,
      memoryLimitMb: 256,
      workerTimeoutMs: 60_000,
      noModuleCache: false,
      envVars: Object.entries(Deno.env.toObject()),
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
