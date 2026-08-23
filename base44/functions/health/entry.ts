import { createClientFromRequest } from "npm:@base44/sdk@0.8.20";
import { verifyBearer } from "./_acaciaSign.ts";

// Module 5: cheap health/latency probe for a human or an external uptime
// monitor to hit directly — NOT the endpoint Mission Control's own polling
// actually uses (that's acaciaControl's HMAC-signed `ping` action; see that
// function's header comment). Gated on the same INGEST_HMAC_SECRET shared
// with Mission Control, checked as a simple bearer value in the `x-health-secret`
// header (there's no request body here to sign, unlike acaciaControl's full
// HMAC). A Base44 security scan flagged the previous, unauthenticated
// version as an "unprotected backend function": anyone on the internet could
// trigger a real service-role DB query on demand, and the error branch
// echoed error.message to the anonymous caller.
Deno.serve(async (req) => {
  const startedAt = Date.now();

  // Compared against THIS app's derived bearer, not the bare shared secret —
  // see _acaciaSign.ts and Module 15 of jospabloh/acacia-app-standard. The old
  // `!==` was also a non-constant-time compare of a secret. While
  // ACCEPT_LEGACY_MASTER is true the bare master is still accepted, so Mission
  // Control's probe keeps working until it sends the derived value.
  const expectedSecret = Deno.env.get("INGEST_HMAC_SECRET") ?? "";
  const slug = Deno.env.get("ACACIA_APP_SLUG") ?? "";
  const providedSecret = req.headers.get("x-health-secret");
  if (!(await verifyBearer(expectedSecret, slug, providedSecret))) {
    return Response.json({ message: "unauthorized" }, { status: 401 });
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
