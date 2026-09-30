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
