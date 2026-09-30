import { assert, assertEquals } from "./_assert.ts";
import { ASSIGNABLE_ROLES, decidePendingAccess, isAssignableRole } from "../functions/manage-member/_joinRules.ts";

Deno.test("only tenant roles are assignable, never the platform admin", () => {
  assertEquals([...ASSIGNABLE_ROLES], ["business_admin", "staff"]);
  assert(isAssignableRole("staff"));
  assert(isAssignableRole("business_admin"));
  assert(!isAssignableRole("admin"));
  assert(!isAssignableRole(""));
  assert(!isAssignableRole(undefined));
  assert(!isAssignableRole({ role: "staff" }));
});

Deno.test("a business_admin resolves requests aimed at their own business only", () => {
  const caller = { role: "business_admin", business_id: "biz1" };
  assertEquals(decidePendingAccess(caller, { pending_business_id: "biz1" }), { ok: true, businessId: "biz1" });
  const other = decidePendingAccess(caller, { pending_business_id: "biz2" });
  assertEquals(other.ok, false);
  // Same answer as a request that does not exist: no existence oracle.
  const missing = decidePendingAccess(caller, { pending_business_id: null });
  assertEquals(missing.ok === false && other.ok === false && other.message === missing.message, true);
});

Deno.test("staff and anonymous callers can never resolve requests", () => {
  for (const c of [{ role: "staff", business_id: "biz1" }, { role: "user" }, null, undefined]) {
    const r = decidePendingAccess(c, { pending_business_id: "biz1" });
    assertEquals(r.ok, false);
  }
});

Deno.test("a business_admin without a business is refused", () => {
  assertEquals(decidePendingAccess({ role: "business_admin", business_id: null }, { pending_business_id: "biz1" }).ok, false);
});

Deno.test("the platform admin resolves any request, using the stored business", () => {
  assertEquals(
    decidePendingAccess({ role: "admin" }, { pending_business_id: "biz9" }),
    { ok: true, businessId: "biz9" },
  );
  assertEquals(decidePendingAccess({ role: "admin" }, { pending_business_id: null }).ok, false);
});

Deno.test("last-admin guard: pre-check and recount", async () => {
  const { wouldLeaveNoAdmin, lostAllAdmins, countTenantAdmins } = await import("../functions/manage-member/_joinRules.ts");
  const admin = { role: "business_admin" };
  const staff = { role: "staff" };
  // Sole admin cannot be demoted or removed; staff can always be changed.
  assert(wouldLeaveNoAdmin([admin, staff], admin, "staff"));
  assert(wouldLeaveNoAdmin([admin, staff], admin, null));
  assert(!wouldLeaveNoAdmin([admin, staff], staff, null));
  assert(!wouldLeaveNoAdmin([admin, staff], admin, "business_admin"));
  // Two admins: one may go. The platform owner as member counts as present.
  assert(!wouldLeaveNoAdmin([admin, admin], admin, "staff"));
  assert(!wouldLeaveNoAdmin([admin, { role: "admin" }], admin, null));
  assertEquals(countTenantAdmins([admin, staff, { role: "admin" }]), 2);
  // Recount only blames a write that took an admin away.
  assert(lostAllAdmins([staff], true));
  assert(!lostAllAdmins([staff], false));
  assert(!lostAllAdmins([admin], true));
});
