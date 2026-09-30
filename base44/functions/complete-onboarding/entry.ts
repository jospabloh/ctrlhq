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
const BUILD = "2026-09-30.join-request.1";

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
// mode "join": the caller redeems an existing business's invite_code. That
// does NOT grant access any more (2026-09-30): it only records a PENDING
// request (User.pending_business_id). Until a business_admin of that business
// approves it — choosing the role — from Cuenta > Miembros (manage-member's
// "approve"), the caller has no business_id and sees no data. No path in this
// function writes business_id/role for a joiner.
// mode "cancel_join": the caller withdraws their own pending request.
// mode "status": what the onboarding screen needs to survive a reload —
// whether a request is pending (and for which business) or already approved.

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
    const { mode, businessName, inviteCode } = await req.json();

    // Fresh read of the caller: the cached session (auth.me) can lag behind
    // what is stored, and both decisions below (already in a business? already
    // waiting on one?) must come from the stored record.
    const fresh = await base44.asServiceRole.entities.User.get(user.id).catch(() => null);
    const currentBusinessId = fresh?.business_id || user.business_id;
    const pendingBusinessId: string | null = fresh?.pending_business_id || null;

    if (mode === "status") {
      if (currentBusinessId) return Response.json({ hasBusiness: true, pending: null, build: BUILD });
      if (!pendingBusinessId) return Response.json({ hasBusiness: false, pending: null, build: BUILD });
      const pendingBusiness = await base44.asServiceRole.entities.Business.get(pendingBusinessId).catch(() => null);
      if (!pendingBusiness) {
        // The business was deleted while the request waited: drop the request
        // so the person can start over instead of waiting forever.
        await withTimeout(
          base44.asServiceRole.entities.User.update(user.id, { pending_business_id: null }),
          25_000,
          "Limpiar tu solicitud"
        );
        return Response.json({ hasBusiness: false, pending: null, build: BUILD });
      }
      return Response.json({ hasBusiness: false, pending: { businessName: pendingBusiness.name }, build: BUILD });
    }

    if (mode === "cancel_join") {
      if (pendingBusinessId) {
        await withTimeout(
          base44.asServiceRole.entities.User.update(user.id, { pending_business_id: null }),
          25_000,
          "Cancelar tu solicitud"
        );
      }
      return Response.json({ ok: true, build: BUILD });
    }

    // One user, one tenant. A caller who already has a business_id cannot
    // create or join another: the tenant picker that used to let them move
    // between businesses is gone, so a second business would strand the first
    // with no way back. Leaving a tenant is manage-member's "remove", run by
    // that tenant's own admin.
    if (currentBusinessId) {
      return Response.json(
        { message: "Ya perteneces a un negocio. Pide a un administrador que te dé de baja antes de unirte a otro." },
        { status: 409 }
      );
    }

    if (mode === "create") {
      // A waiting joiner cannot also create a business: cancel the request first.
      if (pendingBusinessId) {
        return Response.json(
          { message: "Tienes una solicitud pendiente de aprobación. Cancélala antes de crear un negocio." },
          { status: 409 }
        );
      }
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
      if (pendingBusinessId && pendingBusinessId !== business.id) {
        return Response.json(
          { message: "Ya tienes una solicitud pendiente en otro negocio. Cancélala antes de pedir unirte a este." },
          { status: 409 }
        );
      }
      // Idempotent for the same business (double click, retry after a reload).
      if (!pendingBusinessId) {
        await withTimeout(
          base44.asServiceRole.entities.User.update(user.id, { pending_business_id: business.id }),
          25_000,
          "Registrar tu solicitud"
        );
      }
      // Deliberately NOT returning the Business record: it carries the invite
      // code and license fields, and the caller has no access yet.
      return Response.json({ pending: { businessName: business.name }, build: BUILD });
    }

    return Response.json({ message: "mode debe ser 'create', 'join', 'cancel_join' o 'status'." }, { status: 400 });
  } catch (error) {
    return Response.json({ message: error.message }, { status: 500 });
  }
});
