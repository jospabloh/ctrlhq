import { createClientFromRequest } from "npm:@base44/sdk";

// Module 5: cheap health/latency probe Mission Control's base44 adapter
// polls for the portfolio dashboard. Measures a real round trip (a bounded
// Business.list call as service role), never a hardcoded 200.
Deno.serve(async (req) => {
  const startedAt = Date.now();
  try {
    const base44 = createClientFromRequest(req);
    await base44.asServiceRole.entities.Business.list(null, 1);
    return Response.json({
      status: "ok",
      latency_ms: Date.now() - startedAt,
      checked_at: new Date().toISOString(),
    });
  } catch (error) {
    return Response.json(
      {
        status: "error",
        latency_ms: Date.now() - startedAt,
        error: error.message,
        checked_at: new Date().toISOString(),
      },
      { status: 503 }
    );
  }
});
