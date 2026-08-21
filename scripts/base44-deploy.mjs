#!/usr/bin/env node
// Guarded Base44 deploy (ACACIA portfolio standard).
//
// WHY THIS EXISTS — the 2026-08-21 incident:
//   Every deploy command was run by hand as
//     npx base44 functions deploy --app-id <id> --force
//   from whatever directory the shell happened to be in. A `git pull` failed
//   in flowfin, the session stayed in that folder, and the next six commands
//   pushed FLOWFIN's base44/ into puntos, radar, stockflow and ctrlhq — the
//   CLI takes its source from the CURRENT DIRECTORY and its target from
//   --app-id, and nothing ever checks that the two agree. It overwrote
//   `acaciaControl` in three apps and, in radar, `entities push` deleted the
//   entire data model and replaced it with flowfin's.
//
// The fix is to make that mismatch unrepresentable: the app id lives in this
// repo's base44.app.json, and this script REFUSES an --app-id from argv. You
// can only ever deploy the app whose id sits in the folder you are standing in.
//
// Usage:
//   npm run deploy            → functions only (safe, additive + prune)
//   npm run deploy:entities   → schema push (DESTRUCTIVE, typed confirmation)

import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { findEndpoints } from './validate-functions.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const HARD_CAP = 50;

function die(message, hint) {
  console.error(`\n✗ ${message}`);
  if (hint) console.error(`  ${hint}`);
  process.exit(1);
}

// --- Guard 1: an --app-id on the command line is the exact mistake this
// script exists to prevent. Refuse it outright rather than honour it.
const argv = process.argv.slice(2);
if (argv.some((a) => a.startsWith('--app-id'))) {
  die(
    'No pases --app-id a este script.',
    'El id sale de base44.app.json, para que el directorio y la app destino no puedan desalinearse.',
  );
}

// --- Guard 2: this must be a Base44 app repo, and it must be THIS one.
const configFile = path.join(ROOT, 'base44.app.json');
if (!existsSync(configFile)) {
  die(
    `No hay base44.app.json en ${ROOT}.`,
    'Estás fuera de un repo de app Base44, o al repo le falta el archivo. No se deploya nada.',
  );
}
const config = JSON.parse(readFileSync(configFile, 'utf8'));
if (!config.appId || !config.name) die('base44.app.json necesita `appId` y `name`.');
if (!existsSync(path.join(ROOT, 'base44'))) die(`${ROOT} no tiene un directorio base44/.`);

const pushEntities = argv.includes('--entities');

// --- Guard 3: never start a deploy that cannot finish. Over the cap, the CLI
// errors partway and skips its own prune phase, stranding foreign functions.
const endpoints = findEndpoints(path.join(ROOT, 'base44', 'functions'));
const ceiling = Number.isInteger(config.maxFunctions) ? config.maxFunctions : 40;
if (endpoints.length > HARD_CAP) {
  die(
    `${endpoints.length} endpoints locales — Base44 corta en ${HARD_CAP}.`,
    'El deploy fallaría a medias. Consolida antes de intentarlo.',
  );
}

console.log(`\n  App:        ${config.name}`);
console.log(`  App id:     ${config.appId}`);
console.log(`  Directorio: ${ROOT}`);
console.log(`  Endpoints:  ${endpoints.length} (techo ${ceiling}, límite Base44 ${HARD_CAP})`);

// --- Preflight: what is on the remote that is not here? Those occupy slots
// and, if the total would exceed the cap, the deploy dies before pruning them.
const listed = spawnSync('npx', ['base44', 'functions', 'list', '--app-id', config.appId], {
  encoding: 'utf8',
});
if (listed.status === 0) {
  const local = new Set(endpoints.map((e) => e.split(path.sep)[0]));
  const remote = (listed.stdout.match(/^\s*│\s{4}(\S+)/gm) || [])
    .map((l) => l.replace(/^\s*│\s+/, '').trim())
    .filter(Boolean);
  const foreign = remote.filter((fn) => !local.has(fn));

  if (foreign.length) {
    console.log(`\n  ⚠ ${foreign.length} funciones en el remoto que NO están en este repo:`);
    console.log(`    ${foreign.join(', ')}`);
    console.log('    El --force las poda, PERO solo si el deploy termina sin errores.');
    if (remote.length + endpoints.filter((e) => !remote.includes(e)).length > HARD_CAP) {
      console.log(`\n    Remoto (${remote.length}) + nuevas locales pasa de ${HARD_CAP}: el deploy va a fallar antes de podar.`);
      console.log('    Saca temporalmente las funciones NUEVAS del repo, deploya para que pode, y vuelve a meterlas:');
      console.log('      mv base44/functions/<nueva> /tmp/hold && npm run deploy && mv /tmp/hold base44/functions/<nueva> && npm run deploy');
    }
  }
} else {
  console.log('\n  ⚠ No se pudo listar el remoto (¿sesión de Base44 sin iniciar?). Se continúa sin preflight.');
}

async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question(question, resolve));
  rl.close();
  return answer.trim();
}

function run(args) {
  console.log(`\n$ npx base44 ${args.join(' ')}\n`);
  const result = spawnSync('npx', ['base44', ...args], { stdio: 'inherit' });
  return result.status ?? 1;
}

const steps = [['functions', 'deploy', '--app-id', config.appId, '--force']];

if (pushEntities) {
  // `entities push` deletes every remote entity absent locally — this is what
  // wiped radar's data model. Make the blast radius visible and require the
  // app's own name, so muscle memory alone cannot fire it.
  const entitiesDir = path.join(ROOT, 'base44', 'entities');
  const names = existsSync(entitiesDir)
    ? (await import('node:fs')).readdirSync(entitiesDir).filter((f) => f.endsWith('.jsonc')).map((f) => f.replace('.jsonc', ''))
    : [];
  console.log(`\n  ⚠ ENTITIES PUSH — borra del remoto toda entidad que no esté aquí.`);
  console.log(`  Se enviarán ${names.length} entidades de ${config.name}:`);
  console.log(`    ${names.join(', ')}`);
  const typed = await confirm(`\n  Escribe "${config.name}" para confirmar: `);
  if (typed !== config.name) die('Confirmación no coincide. No se envió nada.');
  steps.push(['entities', 'push', '--app-id', config.appId]);
}

for (const args of steps) {
  const code = run(args);
  if (code !== 0) {
    die(`\`base44 ${args.slice(0, 2).join(' ')}\` salió con código ${code}.`, 'Revisa el output de arriba antes de reintentar.');
  }
}

console.log(`\n✓ ${config.name} desplegado.\n`);
