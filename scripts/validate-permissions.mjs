#!/usr/bin/env node
// Drift guard between the client permission registry and its server-side
// mirror (STANDARD.md Module 3).
//
// base44/functions/guardedEntityWrite/entry.ts re-checks the same
// "Section:action" keys the client gates its buttons on. Deno functions cannot
// import from src/, so that file keeps a hand-written copy of
// src/lib/permissionRegistry.js's PERMISSION_REGISTRY. A copy nobody checks is
// a copy that silently drifts — and the failure mode is the worst possible
// one: the client hides a button the server still allows, or the server denies
// something the client shows as available.
//
// This parses both sides and fails on ANY difference: a missing key, an extra
// key, or a different per-role default. It also fails if guardedEntityWrite
// references a key that does not exist in the registry at all.
//
// Run: node scripts/validate-permissions.mjs   (wired into `npm run lint`)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const REGISTRY = path.join(ROOT, "src", "lib", "permissionRegistry.js");
const MIRROR = path.join(ROOT, "base44", "functions", "guardedEntityWrite", "entry.ts");

const ROLE_TOKENS = {
  "[ROLES.BUSINESS_ADMIN]": "business_admin",
  "[ROLES.STAFF]": "staff",
};

function parseBlock(source, openMarker) {
  const start = source.indexOf(openMarker);
  if (start === -1) throw new Error(`No se encontró "${openMarker}"`);
  const braceStart = source.indexOf("{", start);
  let depth = 0;
  let end = braceStart;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  return source.slice(braceStart, end + 1);
}

// Both sides use the same line shape:
//   "Section:action": { <role>: true, <role>: false },
function parseKeys(block, roleMap) {
  const out = {};
  const lineRe = /"([^"]+)":\s*\{([^}]*)\}/g;
  let m;
  while ((m = lineRe.exec(block)) !== null) {
    const key = m[1];
    const roles = {};
    for (const part of m[2].split(",")) {
      const pair = part.split(":");
      if (pair.length < 2) continue;
      const rawRole = pair[0].trim();
      const role = roleMap ? roleMap[rawRole] : rawRole.replace(/^["']|["']$/g, "");
      if (!role) continue;
      roles[role] = pair[1].trim() === "true";
    }
    out[key] = roles;
  }
  return out;
}

const registrySource = readFileSync(REGISTRY, "utf8");
const mirrorSource = readFileSync(MIRROR, "utf8");

const client = parseKeys(parseBlock(registrySource, "export const PERMISSION_REGISTRY"), ROLE_TOKENS);
const server = parseKeys(parseBlock(mirrorSource, "const PERMISSION_DEFAULTS"), null);

const errors = [];

if (Object.keys(client).length === 0) errors.push("El registry del cliente se parseó vacío — revisa el parser.");
if (Object.keys(server).length === 0) errors.push("El mirror del servidor se parseó vacío — revisa el parser.");

for (const key of Object.keys(client)) {
  if (!(key in server)) {
    errors.push(`Falta en guardedEntityWrite/entry.ts: "${key}"`);
    continue;
  }
  for (const role of Object.keys(client[key])) {
    if (client[key][role] !== server[key][role]) {
      errors.push(
        `Default distinto para "${key}" / ${role}: cliente=${client[key][role]} servidor=${server[key][role]}`,
      );
    }
  }
}
for (const key of Object.keys(server)) {
  if (!(key in client)) errors.push(`Sobra en guardedEntityWrite/entry.ts (no existe en el registry): "${key}"`);
}

// Every key ENTITY_CONFIG points at must be a real registry key, or the
// server would deny a write nobody can grant.
const configBlock = parseBlock(mirrorSource, "const ENTITY_CONFIG");
for (const m of configBlock.matchAll(/(?:create|update|delete):\s*"([^"]+)"/g)) {
  if (!(m[1] in client)) errors.push(`ENTITY_CONFIG apunta a una clave inexistente: "${m[1]}"`);
}

if (errors.length) {
  console.error("✗ Permisos desincronizados entre cliente y servidor:\n");
  for (const e of errors) console.error(`  - ${e}`);
  console.error("\nCorrige src/lib/permissionRegistry.js o el mirror en guardedEntityWrite/entry.ts.");
  process.exit(1);
}

console.log(
  `✓ Permission registry validation passed (${Object.keys(client).length} claves, cliente y servidor iguales).`,
);
