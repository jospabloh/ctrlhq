// ACACIA ↔ Mission Control bridge — key derivation and body signing.
//
// CANONICAL SOURCE. This file is byte-identical in every portfolio app, at
// `base44/functions/<fn>/_acaciaSign.ts`. Change it HERE and copy it out; do
// not edit a copy. Deno isolates each function directory, so an app with three
// bridge-touching functions carries three identical copies — that is expected,
// and `npm run validate:bridge` fails the build if they drift.
//
// WHY A DERIVED KEY EXISTS
//
// `INGEST_HMAC_SECRET` is ONE value shared by the whole portfolio. A signature
// made with it therefore proves "someone who holds the shared secret" — never
// "this is app X". The 2026-08-23 module-14 audit of Mission Control found the
// consequence: any app could sign a ticket payload naming a DIFFERENT app, and
// Mission Control would write it under that attribution, because the `app`
// field travels in the body and the key that signs it is the same everywhere.
//
// The fix is to stop using the master secret directly. Each app signs and
// verifies with a key derived from the master AND its own slug, so a signature
// only ever validates for the app it claims to be. The master never leaves the
// derivation.
//
//   appKey = HMAC-SHA256(master, "acacia.app.v1." + slug)
//
// The "acacia.app.v1." prefix is domain separation: it guarantees a derived key
// can never coincide with a signature computed over a request body, and the
// `v1` gives us a way to rotate the scheme without rotating the master.
//
// MIGRATION — NOT DONE. Four apps still fail the derived key.
//
// The flag exists because Mission Control and nine apps deploy separately: MC
// on merge, the apps by hand. Accepting EITHER key makes deploy order
// irrelevant, so nothing goes dark while the fleet catches up.
//
// Where it actually stands, measured rather than assumed:
//   - 2026-08-23 — all nine apps deployed with derived VERIFICATION.
//   - 2026-08-24 — MC switched to derived SIGNING. A sync of all nine had
//     radar, rumbo, puntos and liuma REJECT the derived key and accept the
//     master; the other five verified derived on the first attempt. The five
//     that work are the five given ACACIA_APP_SLUG that day. The four that
//     fail are the four whose slug predates this work.
//
// The flag was set to false that afternoon on a claim that nothing had fallen
// back — written without reading the warnings that said otherwise — and the
// four apps lost their bridge until it was reverted. That is why the wording
// below is a measurement and not a date.
//
// TO FINISH: fix those four (read ACACIA_APP_SLUG in each app's Base44 panel —
// it must equal the Mission Control id exactly — and redeploy acaciaControl in
// case the live copy predates this file). Then run a full nine-app sync and
// read Mission Control's log for that window. ZERO "rejected the derived key"
// warnings is the gate. Only then set this false, everywhere, in the same pass
// that deletes MC's appBridge fallback.
//
// A NEW app should be created with this already false: it has no legacy
// signature in flight, so there is nothing for the flag to protect.

export const ACCEPT_LEGACY_MASTER = true;

const encoder = new TextEncoder();

/** Deterministic JSON: keys sorted recursively, so both sides sign the same
 *  string. Must stay identical to Mission Control's `stableStringify`. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

export function canonicalMessage(ts: string | number, action: string, params: unknown): string {
  return `${ts}.${action}.${stableStringify(params ?? {})}`;
}

async function hmacHex(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
  return Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * This app's own bridge key. `slug` is the app's Mission Control id — the same
 * value as `apps.id` in the bodega and as the `ACACIA_APP_SLUG` app secret.
 *
 * TEST VECTOR — master "test-master", slug "puntos" derives
 *   b22a11d857d2f7b72ad625d5dfbf08458699a7e972ecb5230285c8cfe40268ec
 * Mission Control's Node implementation asserts the same vector in
 * `api/_lib/ingestSign.test.js`. If the two ever disagree the bridge dies
 * silently with "bad signature", so the vector is the canary, not decoration.
 */
export function deriveAppKey(master: string, slug: string): Promise<string> {
  return hmacHex(master, `acacia.app.v1.${slug}`);
}

/** Sign a bridge body with this app's derived key. */
export async function signAs(
  master: string,
  slug: string,
  ts: string | number,
  action: string,
  params: unknown,
): Promise<string> {
  const key = await deriveAppKey(master, slug);
  return hmacHex(key, canonicalMessage(ts, action, params));
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verify an incoming bridge body against this app's derived key. The master is
 * accepted only while ACCEPT_LEGACY_MASTER is true, which it still is.
 * Rejects on a stale timestamp before doing any crypto: the replay window is
 * the cheap check.
 */
export async function verifyAs(
  master: string,
  slug: string,
  { ts, action, params, sig, maxSkewMs = 300_000, now = Date.now() }: {
    ts: string | number;
    action: string;
    params: unknown;
    sig: string;
    maxSkewMs?: number;
    now?: number;
  },
): Promise<boolean> {
  if (!master || !ts || !sig) return false;
  // Number(ts) on a non-numeric value is NaN, and `NaN > maxSkewMs` is false —
  // so a bare comparison lets a malformed ts through the freshness window
  // instead of rejecting it. The apps' acaciaControl already guarded this;
  // the guard belongs here now that this file owns the check.
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(now - tsNum) > maxSkewMs) return false;

  const message = canonicalMessage(ts, action, params);

  // A missing slug falls through to the legacy branch below rather than
  // failing outright, which is what keeps an app alive while its secret is
  // still missing. Once the flag is false that same fall-through becomes a
  // hard failure, which is the point: an app that keeps working without
  // ACACIA_APP_SLUG is an app whose signature proves nothing about which app
  // it is.
  if (slug) {
    const key = await deriveAppKey(master, slug);
    if (timingSafeEqualHex(await hmacHex(key, message), String(sig))) return true;
  }

  if (ACCEPT_LEGACY_MASTER) {
    return timingSafeEqualHex(await hmacHex(master, message), String(sig));
  }
  return false;
}

/**
 * The bearer form, for endpoints with no body to sign (`health`,
 * `generarAlertas`). Same derivation, compared in constant time. Callers send
 * the derived value in `x-health-secret`; Mission Control computes it per app.
 */
export async function verifyBearer(
  master: string,
  slug: string,
  provided: string | null,
): Promise<boolean> {
  if (!master || !provided) return false;
  // Missing slug → legacy only, same reasoning as verifyAs.
  if (slug && timingSafeEqualHex(await deriveAppKey(master, slug), provided)) return true;
  if (ACCEPT_LEGACY_MASTER) return timingSafeEqualHex(master, provided);
  return false;
}
