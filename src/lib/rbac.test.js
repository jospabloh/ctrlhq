import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ASSIGNABLE_ROLES, ROLES } from "./rbac.js";

test("the roles a business_admin can hand out never include the platform admin", () => {
  assert.ok(!ASSIGNABLE_ROLES.includes(ROLES.ADMIN));
  assert.deepEqual([...ASSIGNABLE_ROLES], ["business_admin", "staff"]);
});

test("client and server assignable-role whitelists do not drift", () => {
  const src = readFileSync(new URL("../../base44/functions/manage-member/_joinRules.ts", import.meta.url), "utf8");
  const match = src.match(/ASSIGNABLE_ROLES = \[([^\]]*)\]/);
  assert.ok(match, "ASSIGNABLE_ROLES not found in _joinRules.ts");
  const server = match[1].split(",").map((t) => t.trim().replace(/^"|"$/g, "")).filter(Boolean);
  assert.deepEqual(server, [...ASSIGNABLE_ROLES]);
});
