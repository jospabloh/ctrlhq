import { createClientFromRequest } from "npm:@base44/sdk";

// Module 5: cheap health/latency probe for a human or an external uptime
// monitor to hit directly — NOT the endpoint Mission Control's own polling
// actually uses (that's acaciaControl's HMAC-signed `ping` action; see that
// function's header comment). Gated on the same INGEST_HMAC_SECRET shared
// with Mission Control, checked as a simple bearer value (there's no request
// body here to sign, unlike acaciaControl's full HMAC). A Base44 security
// scan flagged the previous, unauthenticated version as an "unprotected
// backend function": anyone on the internet could trigger a real
// service-role DB query on demand, and the error branch echoed
// error.message to the anonymous caller.
Deno.serve(async (req) => {
  const startedAt = Date.now();

  const expectedSecret = Deno.env.get("INGEST_HMAC_SECRET");
  const providedSecret = req.headers.get("x-health-secret");
  if (!expectedSecret || providedSecret !== expectedSecret) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const base44 = createClientFromRequest(req);
    await base44.asServiceRole.entities.Business.list(null, 1);
    return Response.json({
      status: "ok",
      latency_ms: Date.now() - startedAt,
      checked_at: new Date().toISOString(),
    });
  } catch {
    // Deliberately no error.message in the response — that's an internal
    // detail, not something an external caller (even an authorized one)
    // needs to see. Base44's own logs still capture the real error.
    return Response.json(
      {
        status: "error",
        latency_ms: Date.now() - startedAt,
        checked_at: new Date().toISOString(),
      },
      { status: 503 }
    );
  }
});
