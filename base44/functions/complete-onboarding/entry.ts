import { createClientFromRequest } from "npm:@base44/sdk@0.8.20";

// Which build is actually answering. Bump this on every meaningful change.
//
// This exists because `base44 functions deploy` reported success — first
// "deployed (1.3s)", later "unchanged" — while the runtime kept serving the
// previous build. It was caught only by accident: the stale build rejected a
// second business with the pre-multi-tenancy wording, which this source no
// longer produces. Without that tell there was no way to distinguish a deploy
// that landed from one that did not. Every response now names its build, so
// the next person reads it off the wire instead of inferring it.
//
// (Deliberately paraphrased rather than quoting the old string: a comment
// containing it makes `grep` report the guard as still present, which cost a
// few minutes of double-checking the first time.)
const BUILD = "2026-08-20.multitenant.1";

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

// The platform owner (role "admin") keeps that role when they join a tenant —
// they get a business_id and nothing else. Two reasons:
//
// 1. Correctness. "admin" is the ACACIA platform tier, not a tenant tier
//    (src/lib/rbac.js). Demoting the owner to business_admin because they
//    happened to create a business would strip the tier every entity's RLS
//    service-role branch is written against. stockflow does the same thing —
//    restoreOwnerAdmin writes { business_id, role: "admin" }, keeping the
//    owner an admin *with* a tenant.
//
// 2. It does not work anyway. The owner's User row is also the app's Base44
//    collaborator record (collaborator_role: "editor", _app_role mirroring
//    role). Writing role away from "admin" on that row never returns — the
//    request hangs and the runtime kills it, so the browser sees an
//    empty-bodied HTTP 500. Every other account onboards fine; this one
//    account did not, and the only thing different about it is that it owns
//    the app.
function rolePatchFor(user: { role?: string }, tenantRole: string) {
  return user.role === "admin" ? {} : { role: tenantRole };
}

// asServiceRole writes to the built-in User entity can hang rather than throw
// (see base44/entities/User.jsonc's header comment). A hang gives the caller
// an empty-bodied 500 with nothing to act on, so bound it and report what
// actually happened instead.
async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: number | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} no respondió en ${ms / 1000}s.`)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

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
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    }
    // No blanket "you already have a business" rejection any more: a user may
    // belong to several tenants (see base44/entities/Membership.jsonc). Joining
    // one twice is still refused, below, where we know which one.

    const { mode, businessName, inviteCode } = await req.json();

    if (mode === "create") {
      const name = (businessName || "").trim();
      if (!name) {
        return Response.json({ message: "El nombre del negocio es obligatorio." }, { status: 400 });
      }
      const business = await base44.asServiceRole.entities.Business.create({
        name,
        billing_status: "trial",
        invite_code: randomInviteCode(),
      });
      try {
        await base44.asServiceRole.entities.Membership.create({
          business_id: business.id,
          user_id: user.id,
          user_email: user.email,
          role: "business_admin",
        });
        await withTimeout(
          base44.asServiceRole.entities.User.update(user.id, {
            ...rolePatchFor(user, "business_admin"),
            business_id: business.id,
          }),
          25_000,
          "La asignación de tu negocio a tu cuenta"
        );
      } catch (error) {
        // The Business landed but nobody got attached to it. Roll it back
        // rather than leaving a tenant with an invite code and no members —
        // five of those accumulated while this bug was being chased, and a
        // stray invite code is the one part of that mess with a real
        // security edge. Best-effort: if the rollback itself fails, the
        // original error is still what the caller needs to hear.
        try {
          const stale = await base44.asServiceRole.entities.Membership.filter(
            { business_id: business.id }, null, 100
          );
          for (const m of stale || []) {
            await base44.asServiceRole.entities.Membership.delete(m.id);
          }
          await base44.asServiceRole.entities.Business.delete(business.id);
        } catch (_) { /* keep reporting the original failure */ }
        throw error;
      }
      return Response.json({ business, build: BUILD });
    }

    if (mode === "join") {
      const code = (inviteCode || "").trim().toUpperCase();
      if (!code) {
        return Response.json({ message: "El código de invitación es obligatorio." }, { status: 400 });
      }
      const matches = await base44.asServiceRole.entities.Business.filter({ invite_code: code }, null, 1);
      const business = matches?.[0];
      if (!business) {
        return Response.json({ message: "Código de invitación inválido." }, { status: 404 });
      }
      const already = await base44.asServiceRole.entities.Membership.filter(
        { user_id: user.id, business_id: business.id }, null, 1
      );
      if (!already?.length) {
        await base44.asServiceRole.entities.Membership.create({
          business_id: business.id,
          user_id: user.id,
          user_email: user.email,
          role: "staff",
        });
      } else if (user.business_id === business.id) {
        return Response.json({ message: "Ya perteneces a ese negocio." }, { status: 409 });
      }
      await withTimeout(
        base44.asServiceRole.entities.User.update(user.id, {
          ...rolePatchFor(user, already?.[0]?.role || "staff"),
          business_id: business.id,
        }),
        25_000,
        "La asignación de tu negocio a tu cuenta"
      );
      return Response.json({ business, build: BUILD });
    }

    return Response.json({ message: "mode debe ser 'create' o 'join'." }, { status: 400 });
  } catch (error) {
    return Response.json({ message: error.message }, { status: 500 });
  }
});
