import { base44 } from "@/api/base44Client";

// Client-side wrapper over base44/functions/guardedEntityWrite — the sanctioned
// write path for Income / Expense / Payroll / TeamConsumption (Module 3).
//
// These four used to be written directly with base44.entities.X.create/
// update/delete(), which meant RLS was the only server-side gate: it enforces
// tenant isolation, but has no way to see a PermissionProfile override or the
// Business's billing_status (which lives on a different row — Base44 RLS
// templates can't join). Both were therefore UI-only until this landed.
//
// Same calling shape as the entity SDK it replaces — data in, record out — so
// migrating a call site is a near-mechanical swap. The SDK throws on a
// non-2xx response with the function's own `message` on the error, which is
// what every existing catch block in this app already reads.

async function invoke(payload) {
  const response = await base44.functions.invoke("guardedEntityWrite", payload);
  return response?.data?.record ?? response?.data;
}

export function guardedCreate(entity, data) {
  return invoke({ entity, operation: "create", data });
}

export function guardedUpdate(entity, id, data) {
  return invoke({ entity, operation: "update", id, data });
}

export function guardedDelete(entity, id) {
  return invoke({ entity, operation: "delete", id });
}
