import { createClientFromRequest } from "npm:@base44/sdk";

// Onboarding "Safe function" (STANDARD.md Modules 2 & 3): the ONLY place a
// user's role/business_id are ever set. Runs the actual writes as service
// role so it can bypass the User entity's admin-only field lock on
// role/business_id (base44/entities/User.jsonc) — but only after validating
// the request itself server-side, independently of whatever the client UI
// shows. That independent re-check is exactly the pattern the stockflow
// incident (STANDARD.md Module 3) needed and didn't have.
//
// mode "create": the caller becomes business_admin of a brand-new Business
// (billing_status starts "trial" — Mission Control's unified lifecycle cron
// takes it from there; this function never touches billing_status again).
// mode "join": the caller redeems an existing business's invite_code and
// becomes staff.

function randomInviteCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (user.business_id) {
      return Response.json({ error: "Ya perteneces a un negocio." }, { status: 409 });
    }

    const { mode, businessName, inviteCode } = await req.json();

    if (mode === "create") {
      const name = (businessName || "").trim();
      if (!name) {
        return Response.json({ error: "El nombre del negocio es obligatorio." }, { status: 400 });
      }
      const business = await base44.asServiceRole.entities.Business.create({
        name,
        billing_status: "trial",
        invite_code: randomInviteCode(),
      });
      await base44.asServiceRole.entities.User.update(user.id, {
        role: "business_admin",
        business_id: business.id,
      });
      return Response.json({ business });
    }

    if (mode === "join") {
      const code = (inviteCode || "").trim().toUpperCase();
      if (!code) {
        return Response.json({ error: "El código de invitación es obligatorio." }, { status: 400 });
      }
      const matches = await base44.asServiceRole.entities.Business.filter({ invite_code: code }, null, 1);
      const business = matches?.[0];
      if (!business) {
        return Response.json({ error: "Código de invitación inválido." }, { status: 404 });
      }
      await base44.asServiceRole.entities.User.update(user.id, {
        role: "staff",
        business_id: business.id,
      });
      return Response.json({ business });
    }

    return Response.json({ error: "mode debe ser 'create' o 'join'." }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
