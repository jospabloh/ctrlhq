import { createClientFromRequest } from "npm:@base44/sdk@0.8.20";

// See complete-onboarding's BUILD comment: deploys have silently served stale
// code here, so every response names the build that answered it.
const BUILD = "2026-08-20.multitenant.1";

// switch-tenant — moves the caller into one of the businesses they belong to.
//
// This is the ONLY sanctioned way `User.business_id` changes after onboarding.
// It has to be a Safe function rather than a client-side write for the same
// reason complete-onboarding does: `business_id` and `role` are field-locked to
// admin-only writes (base44/entities/User.jsonc), precisely so a browser cannot
// point itself at an arbitrary tenant. That lock is the whole basis of the
// isolation model — every other entity's RLS trusts `{{user.data.business_id}}`
// to name a tenant the caller is actually entitled to.
//
// So the membership check below is not a convenience, it is the check. It is
// re-derived server-side from the Membership entity, never taken from the
// request: the body supplies only which business to move to.
//
// The platform owner (role "admin") keeps that role across every switch — see
// complete-onboarding's header for why writing role on that account fails and
// why it would be wrong even if it worked. Everyone else takes the role their
// membership grants for the business they are entering, which is what lets one
// person be business_admin of one tenant and staff of another.

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

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { businessId } = await req.json();
    if (!businessId) {
      return Response.json({ message: "businessId es obligatorio." }, { status: 400 });
    }
    if (user.business_id === businessId) {
      return Response.json({ business_id: businessId, unchanged: true, build: BUILD });
    }

    const isPlatformAdmin = user.role === "admin";

    // Never trust the caller's claim of membership — re-read it.
    const matches = await base44.asServiceRole.entities.Membership.filter(
      { user_id: user.id, business_id: businessId },
      null,
      1
    );
    const membership = matches?.[0];

    if (!membership && !isPlatformAdmin) {
      // Deliberately the same answer whether the business does not exist or
      // the caller simply is not in it — a tenant's existence is not something
      // an outsider gets to probe for by id.
      return Response.json({ message: "No perteneces a ese negocio." }, { status: 403 });
    }

    const business = await base44.asServiceRole.entities.Business.get(businessId);
    if (!business) {
      return Response.json({ message: "Ese negocio ya no existe." }, { status: 404 });
    }

    await withTimeout(
      base44.asServiceRole.entities.User.update(user.id, {
        // Platform owner keeps "admin"; everyone else takes the role this
        // membership grants for the tenant they are entering.
        ...(isPlatformAdmin ? {} : { role: membership.role }),
        business_id: businessId,
      }),
      25_000,
      "El cambio de negocio"
    );

    return Response.json({ business_id: businessId, business, build: BUILD });
  } catch (error) {
    return Response.json({ message: error.message }, { status: 500 });
  }
});
