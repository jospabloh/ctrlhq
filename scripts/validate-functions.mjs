#!/usr/bin/env node
// Endpoint-count guard (ACACIA portfolio standard).
//
// Base44 caps an app at 50 backend functions. Hitting that cap does not fail
// loudly at commit time — it fails halfway through a deploy, which is far
// worse: the CLI exits non-zero BEFORE its prune phase, so the app is left
// with the new functions missing AND any stale remote ones still occupying
// slots. That is exactly how the 2026-08-21 incident stranded four apps.
//
// A "function" is any directory containing an `entry.ts`/`entry.js`, at any
// depth — nesting does NOT reduce the count, because the function's name is
// its full path. The only way down is consolidation behind a router that
// dispatches on an `action` field (see docs/BACKEND_FUNCTION_LIMIT_REORG.md
// where the repo has one).
//
// Ceiling comes from base44.app.json's `maxFunctions` (default 40) — set
// deliberately below Base44's own 50 so there is headroom to add a function
// without a same-day consolidation scramble.
//
// Run: node scripts/validate-functions.mjs   (wire into `npm run lint`)

import { readdirSync, existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FUNCTIONS_DIR = path.join(ROOT, 'base44', 'functions');
const HARD_CAP = 50; // Base44's own limit — not configurable.

function readConfig() {
  const file = path.join(ROOT, 'base44.app.json');
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    console.error(`✗ base44.app.json ilegible: ${error.message}`);
    process.exit(1);
  }
}

/** Every directory holding an entry.ts/entry.js, at any depth = one endpoint. */
export function findEndpoints(dir, base = dir) {
  const found = [];
  if (!existsSync(dir)) return found;
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (!statSync(full).isDirectory()) continue;
    if (existsSync(path.join(full, 'entry.ts')) || existsSync(path.join(full, 'entry.js'))) {
      found.push(path.relative(base, full));
    }
    found.push(...findEndpoints(full, base));
  }
  return found;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = readConfig();
  const ceiling = Number.isInteger(config.maxFunctions) ? config.maxFunctions : 40;
  const endpoints = findEndpoints(FUNCTIONS_DIR).sort();

  if (endpoints.length > HARD_CAP) {
    console.error(`✗ ${endpoints.length} endpoints — Base44 rechaza más de ${HARD_CAP}. El deploy fallará a medias.`);
    process.exit(1);
  }
  if (endpoints.length > ceiling) {
    console.error(`✗ ${endpoints.length} endpoints, el techo de este repo es ${ceiling} (base44.app.json → maxFunctions).`);
    console.error(`  Base44 corta en ${HARD_CAP}; el margen existe para poder agregar una función sin consolidar el mismo día.`);
    console.error('  Consolida detrás de un router que despache por `action`, o sube el techo a conciencia.');
    process.exit(1);
  }

  const margin = ceiling - endpoints.length;
  console.log(`✓ ${endpoints.length} endpoints (techo ${ceiling}, límite Base44 ${HARD_CAP}) — margen: ${margin}.`);
}
