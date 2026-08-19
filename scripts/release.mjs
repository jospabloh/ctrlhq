#!/usr/bin/env node
// Module 6 (Changelog & versioning) release step — see appConfig.js's header
// comment: "build validates, release generates." Run this by hand
// (`npm run release`) when you want to cut a version; it never runs as part
// of `npm run build`, so a routine build can never silently rewrite the
// changelog. Modeled on stockflow's scripts/publish-release.mjs, trimmed to
// what this repo actually has (no generate:all / audit-permissions steps —
// those are stockflow-specific and don't exist here).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const ROOT = new URL("..", import.meta.url).pathname;
const CONFIG_PATH = join(ROOT, "src", "lib", "appConfig.js");

const rl = createInterface({ input, output });

async function ask(question) {
  if (process.env.CI) return "";
  const answer = await rl.question(question);
  return answer.trim();
}

// Optional: if ANTHROPIC_API_KEY_CTRLHQ is set, ask Claude to draft the
// changelog entries from the git log since the last release. Without it,
// falls back to a single generic line — never blocks the release.
async function draftNotes(gitLog, version) {
  const apiKey = process.env.ANTHROPIC_API_KEY_CTRLHQ;
  if (!apiKey) {
    console.warn("⚠️  ANTHROPIC_API_KEY_CTRLHQ no configurada. Generando nota genérica.");
    return [`Actualización a la versión ${version}`];
  }

  console.log("🤖 Consultando a Anthropic para generar el changelog...");
  const systemPrompt = `Eres un redactor técnico que genera changelogs de software en español (es-MX) para CtrlHQ, un tracker de ingresos/egresos/nómina multi-negocio (multi-tenant).
Escribe cambios concisos, orientados al dueño del negocio, usando un emoji al inicio de cada línea.
Devuelve SOLO un array JSON de strings, sin explicaciones adicionales.`;

  const userPrompt = `Genera las notas de la versión ${version} de CtrlHQ basándote en estos commits de git:
${gitLog}

Responde ÚNICAMENTE con un array JSON de strings, por ejemplo:
["✨ Cambio 1", "🐛 Corrección: Cambio 2"]`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!res.ok) {
      console.warn(`⚠️  Anthropic API falló: ${res.status}`);
      return [`Actualización a la versión ${version}`];
    }

    const data = await res.json();
    const text = data.content?.[0]?.text ?? "[]";
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return [`Actualización a la versión ${version}`];
    return JSON.parse(match[0]);
  } catch (e) {
    console.warn(`⚠️  Anthropic API error: ${e.message}`);
    return [`Actualización a la versión ${version}`];
  }
}

async function main() {
  console.log("== 🚀 CtrlHQ Release Publisher ==\n");

  console.log("📦 Obteniendo commits recientes...");
  let gitLog = "";
  try {
    const lastReleaseCommit = execSync('git log -1 --format="%H" -- src/lib/appConfig.js')
      .toString()
      .trim();
    gitLog = lastReleaseCommit
      ? execSync(`git log ${lastReleaseCommit}..HEAD --oneline`).toString().trim()
      : execSync("git log --oneline -10").toString().trim();

    if (!gitLog) {
      console.log("✅ No hay commits nuevos desde el último release. Cancelando silenciosamente.");
      process.exit(0);
    }
    console.log(gitLog);
  } catch {
    console.log("⚠️  No se pudo leer el historial de git, usando los últimos 10 commits.");
    gitLog = execSync("git log --oneline -10").toString().trim();
  }

  let configSrc = readFileSync(CONFIG_PATH, "utf8");
  const versionMatch = configSrc.match(/export const APP_VERSION = "([^"]+)";/);
  if (!versionMatch) throw new Error("No se pudo encontrar APP_VERSION en appConfig.js");

  const currentVersion = versionMatch[1];
  console.log(`\nVersión actual: ${currentVersion}`);

  const [major, minor, patch] = currentVersion.split(".").map(Number);
  const nextPatch = `${major}.${minor}.${patch + 1}`;

  let newVersion = nextPatch;
  if (!process.env.CI) {
    const userInput = await ask(`Nueva versión (default: ${nextPatch}): `);
    if (userInput) newVersion = userInput;
  }

  const notes = await draftNotes(gitLog, newVersion);
  console.log("\n📝 Notas generadas:");
  notes.forEach((n) => console.log(`  - ${n}`));

  if (!process.env.CI) {
    const confirm = await ask("\n¿Proceder con la actualización? (Y/n): ");
    if (confirm.toLowerCase() === "n") {
      console.log("Cancelado.");
      rl.close();
      process.exit(0);
    }
  }

  const dateStr = new Date().toISOString().split("T")[0];

  configSrc = configSrc.replace(
    /export const APP_VERSION = "[^"]+";/,
    `export const APP_VERSION = "${newVersion}";`
  );
  configSrc = configSrc.replace(
    /export const RELEASE_DATE = "[^"]+";/,
    `export const RELEASE_DATE = "${dateStr}";`
  );

  const notesLiteral = notes.map((n) => `      ${JSON.stringify(n)},`).join("\n");
  const newEntry = `  {
    version: "${newVersion}",
    date: "${dateStr}",
    notes: [
${notesLiteral}
    ],
  },`;

  configSrc = configSrc.replace(
    /export const CHANGELOG = \[\n/,
    `export const CHANGELOG = [\n${newEntry}\n`
  );

  writeFileSync(CONFIG_PATH, configSrc);
  console.log(`\n✅ appConfig.js actualizado a la versión ${newVersion}`);

  if (process.env.CI) {
    console.log("\n✅ Script completado en modo CI. Los cambios están listos para el PR.");
  } else {
    console.log("\n🎉 Release preparado localmente.");
    console.log("Siguientes pasos:");
    console.log("1. Revisa src/lib/appConfig.js.");
    console.log("2. Haz commit y push.");
    console.log("3. Base44 desplegará automáticamente la nueva versión.\n");
  }

  rl.close();
}

main().catch((e) => {
  console.error(e);
  rl.close();
  process.exit(1);
});
