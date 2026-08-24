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
// MIGRATION — DONE. The flag is false, and that is what closed the hole.
//
// It existed because Mission Control and nine apps deploy separately: MC on
// merge, the apps by hand. Accepting EITHER key made deploy order irrelevant,
// so nothing went dark while the fleet caught up.
//
// Both halves are now verified against production, not assumed:
//   - 2026-08-23 — all nine apps deployed with derived VERIFICATION.
//   - 2026-08-24 — MC switched to derived SIGNING, and all nine were synced
//     one by one. Every call verified on the first attempt; the temporary
//     master fallback in MC's appBridge.js never fired once, and has been
//     deleted along with this flag's last reason to be true.
//
// A new app starts here, at false. There is no legacy path to opt into: a
// missing or misspelled ACACIA_APP_SLUG now fails the signature instead of
// quietly degrading to the shared master, which is the whole point.

export const ACCEPT_LEGACY_MASTER = false;

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
 * accepted only while ACCEPT_LEGACY_MASTER is true, which it no longer is.
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

  // With the flag false, a missing slug now FAILS instead of degrading to the
  // shared master. That is deliberate: ACACIA_APP_SLUG is mandatory, and an
  // app that silently kept working without it is an app whose signature proves
  // nothing about which app it is. During the rollout this branch did the
  // opposite — it kept the bridge alive until every secret was in place.
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
