#!/usr/bin/env node
// Static RLS checker (STANDARD.md Module 4). Parses every base44/entities/*.jsonc
// and fails the build on a malformed rule shape (wrong data./{{user.data.}}
// path, missing service-role admin branch on a tenant-scoped entity). This
// only catches malformed rules, not over-restrictive-but-valid ones (the
// FlowFin family_id incident) — a static checker can't know intent, so
// treat a clean run as "no obvious mistakes," not "definitely correct."
//
// Run: node scripts/validate-rls.mjs   (wired into `npm run lint`, see package.json)

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENTITIES_DIR = path.join(__dirname, "..", "base44", "entities");

// Entities that intentionally have no business_id (the tenant root and the
// built-in User, which uses {{user.id}} / {{user.data.business_id}} instead
// of a data.business_id field on itself).
const NON_TENANT_ENTITIES = new Set(["Business", "User"]);

function stripJsonComments(text) {
  // Minimal // and /* */ stripper that respects string literals — enough for
  // our own hand-authored jsonc files, not a general-purpose parser.
  let out = "";
  let inString = false;
  let stringChar = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (inString) {
      out += c;
      if (c === "\\") {
        out += next;
        i++;
      } else if (c === stringChar) {
        inString = false;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      inString = true;
      stringChar = c;
      out += c;
      continue;
    }
    if (c === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
      continue;
    }
    out += c;
  }
  return out;
}

function hasAdminBranch(rule) {
  return JSON.stringify(rule).includes('"user_condition":{"role":"admin"}');
}

function checkEntity(fileName) {
  const filePath = path.join(ENTITIES_DIR, fileName);
  const entityName = fileName.replace(/\.jsonc?$/, "");
  const errors = [];
  const warnings = [];

  let schema;
  try {
    schema = JSON.parse(stripJsonComments(readFileSync(filePath, "utf8")));
  } catch (e) {
    errors.push(`could not parse JSON: ${e.message}`);
    return { entityName, errors, warnings };
  }

  const rls = schema.rls || {};
  const ops = ["create", "read", "update", "delete"];
  const isTenantEntity = !NON_TENANT_ENTITIES.has(entityName);

  // Entity-side custom field paths must be data.-prefixed, never bare.
  const raw = JSON.stringify(rls);
  if (isTenantEntity && /"business_id"\s*:/.test(raw) && !/"data\.business_id"/.test(raw)) {
    errors.push('found a bare "business_id" key in rls — custom entity fields must be "data.business_id", not "business_id" (STANDARD.md Module 4: a bare field points at nothing and RLS matches every row).');
  }

  // User-side custom field templates must use {{user.data.*}}, never
  // {{user.business_id}} (which resolves to nothing → RLS matches zero rows).
  if (raw.includes("{{user.business_id}}")) {
    errors.push('found "{{user.business_id}}" — custom user fields resolve as "{{user.data.business_id}}", not "{{user.business_id}}".');
  }

  for (const op of ops) {
    if (!(op in rls)) {
      warnings.push(`no rls.${op} rule — falls back to the platform default, confirm that's intended.`);
      continue;
    }
    const rule = rls[op];
    if (rule === true || rule === false || rule === null) continue;
    if (isTenantEntity && !hasAdminBranch(rule)) {
      warnings.push(`rls.${op} has no explicit {"user_condition":{"role":"admin"}} branch — service-role calls (Mission Control's adapter, this app's own Safe functions) may get silently rejected on write or return zero rows on read.`);
    }
  }

  return { entityName, errors, warnings };
}

function main() {
  const files = readdirSync(ENTITIES_DIR).filter((f) => f.endsWith(".jsonc") || f.endsWith(".json"));
  let hasErrors = false;
  let hasWarnings = false;

  for (const file of files) {
    const { entityName, errors, warnings } = checkEntity(file);
    for (const e of errors) {
      hasErrors = true;
      console.error(`✖ ${entityName}: ${e}`);
    }
    for (const w of warnings) {
      hasWarnings = true;
      console.warn(`⚠ ${entityName}: ${w}`);
    }
  }

  if (!hasErrors && !hasWarnings) {
    console.log(`✓ validate-rls: ${files.length} entities checked, no issues found.`);
  }

  if (hasErrors) {
    console.error("\nvalidate-rls: failing build — malformed RLS rule(s) above.");
    process.exit(1);
  }
}

main();
