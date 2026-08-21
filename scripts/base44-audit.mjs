#!/usr/bin/env node
// Endpoint inventory (ACACIA portfolio standard).
//
// Answers, per deployed function: who calls it? The point is to make the
// consolidation question decidable instead of guessed at.
//
// The trap this exists for: "no callers in the repo" does NOT mean dead. It
// usually means the opposite — the caller lives OUTSIDE the repo (a Base44
// entity automation, a dashboard cron, an agent tool_config, a webhook URL
// registered with a payment provider). Deleting or renaming one of those
// breaks it silently, with no compile error and no failing test. Both
// flowfin's and stockflow's BACKEND_FUNCTION_LIMIT_REORG.md carry a
// "deliberately left untouched (invoked out-of-band)" list for exactly this
// reason — and both lists have since gone stale.
//
// So this script does not decide anything. It prints what the repo can prove
// and flags the rest as NEEDS DASHBOARD CHECK — cross-check that short list
// against `npx base44 functions list` (which annotates `(N automation)`) and
// the app's Automations panel before touching any of them.
//
// Run: node scripts/base44-audit.mjs

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { findEndpoints } from './validate-functions.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FUNCTIONS_DIR = path.join(ROOT, 'base44', 'functions');
const AGENTS_DIR = path.join(ROOT, 'base44', 'agents');

function grepCount(pattern, dirs) {
  const present = dirs.filter((d) => existsSync(path.join(ROOT, d)));
  if (!present.length) return [];
  try {
    const out = execFileSync('grep', ['-rl', '--', pattern, ...present], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.split('\n').filter(Boolean);
  } catch {
    return []; // grep exits 1 when nothing matches
  }
}

const agentTools = new Set();
if (existsSync(AGENTS_DIR)) {
  for (const file of readdirSync(AGENTS_DIR).filter((f) => f.endsWith('.jsonc'))) {
    const source = readFileSync(path.join(AGENTS_DIR, file), 'utf8');
    for (const m of source.matchAll(/"function_name"\s*:\s*"([^"]+)"/g)) agentTools.add(m[1]);
  }
}

const endpoints = findEndpoints(FUNCTIONS_DIR).sort();
const rows = [];

for (const endpoint of endpoints) {
  const name = endpoint.split(path.sep)[0];
  const dir = path.join(FUNCTIONS_DIR, endpoint);

  const srcCallers = grepCount(name, ['src']).length;
  const fnCallers = grepCount(name, ['base44/functions'])
    .filter((f) => !f.startsWith(`base44/functions/${name}/`)).length;
  const isAgentTool = agentTools.has(name);
  const isRouter = existsSync(path.join(dir, 'handlers'));
  const handlers = isRouter
    ? readdirSync(path.join(dir, 'handlers')).filter((f) => f.endsWith('.ts') && f !== 'index.ts').length
    : 0;

  // A header comment is often the only record that something is an entity hook.
  const entry = existsSync(path.join(dir, 'entry.ts')) ? path.join(dir, 'entry.ts') : path.join(dir, 'entry.js');
  const header = existsSync(entry) ? readFileSync(entry, 'utf8').slice(0, 900) : '';
  const selfDeclaredHook = /entity hook|triggered by base44|cron|scheduled|webhook/i.test(header);

  let verdict;
  if (isAgentTool) verdict = 'agent tool';
  else if (selfDeclaredHook) verdict = 'hook/cron (declarado)';
  else if (srcCallers || fnCallers) verdict = 'en uso (repo)';
  else verdict = 'REVISAR EN PANEL';

  rows.push({ name, verdict, srcCallers, fnCallers, handlers, isRouter });
}

const pad = (s, n) => String(s).padEnd(n);
console.log(`\n  ${endpoints.length} endpoints en ${path.basename(ROOT)}\n`);
console.log(`  ${pad('función', 42)}${pad('veredicto', 24)}${pad('src', 5)}${pad('fn', 5)}handlers`);
console.log(`  ${'─'.repeat(84)}`);
for (const r of rows.sort((a, b) => a.verdict.localeCompare(b.verdict) || a.name.localeCompare(b.name))) {
  console.log(
    `  ${pad(r.name, 42)}${pad(r.verdict, 24)}${pad(r.srcCallers || '·', 5)}${pad(r.fnCallers || '·', 5)}${r.isRouter ? r.handlers : '·'}`,
  );
}

const needsCheck = rows.filter((r) => r.verdict === 'REVISAR EN PANEL');
const routers = rows.filter((r) => r.isRouter);
console.log(`\n  routers: ${routers.length} (absorben ${routers.reduce((n, r) => n + r.handlers, 0)} handlers)`);

if (needsCheck.length) {
  console.log(`\n  ${needsCheck.length} sin llamador en el repo — NO son necesariamente código muerto:`);
  console.log(`    ${needsCheck.map((r) => r.name).join(', ')}`);
  console.log('\n  Antes de borrar o consolidar cualquiera de estas, confirma en el panel:');
  console.log('    npx base44 functions list --app-id <id>     # marca "(N automation)"');
  console.log('    y revisa Automations + agentes en el dashboard.');
}
console.log('');
