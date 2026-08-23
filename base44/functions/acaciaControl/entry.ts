// acaciaControl — ACACIA Mission Control admin bridge for this Base44 app.
//
// Mission Control calls this function over an HMAC-signed body (no user token):
//   { action, params, ts, sig }
// We verify the signature against the app secret INGEST_HMAC_SECRET (set via
// `npx base44 secrets set`), then run the requested action with the service
// role. Single channel for reads (license sync, usage) and writes (Fase 6).
// Same file deploys to every app.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { verifyAs } from './_acaciaSign.ts';

const MAX_SKEW_MS = 5 * 60 * 1000;
const COUNT_CAP = 5000; // Base44 caps list at 5,000 — usage counts are capped here.

// stableStringify / hmacHex / timingSafeEqual used to live here, hand-mirrored
// against Mission Control's api/_lib/ingestSign.js. verifyAs() in
// _acaciaSign.ts owns all three now — a hand-kept mirror of a signing routine
// is exactly the thing that drifts, and a drift here surfaces only as
// "bad signature" at runtime.

Deno.serve(async (req) => {
  try {
    const secret = Deno.env.get('INGEST_HMAC_SECRET');
    if (!secret) return Response.json({ error: 'INGEST_HMAC_SECRET not set in app secrets' }, { status: 500 });

    const body = await req.json().catch(() => ({}));
    const { action, params = {}, ts, sig } = body ?? {};
    if (!action || !ts || !sig) return Response.json({ error: 'missing action/ts/sig' }, { status: 400 });
    if (Math.abs(Date.now() - Number(ts)) > MAX_SKEW_MS) return Response.json({ error: 'stale request' }, { status: 401 });

    // Verified against THIS app's derived key — see _acaciaSign.ts, and Module
    // 15 of jospabloh/acacia-app-standard. While ACCEPT_LEGACY_MASTER is true a
    // signature made with the bare INGEST_HMAC_SECRET is still accepted, which
    // is what lets Mission Control and the nine apps deploy in any order.
    const slug = Deno.env.get('ACACIA_APP_SLUG') ?? '';
    if (!(await verifyAs(secret, slug, { ts, action, params, sig }))) {
      return Response.json({ error: 'bad signature' }, { status: 401 });
    }

    const base44 = createClientFromRequest(req);
    const sr = base44.asServiceRole;

    switch (action) {
      case 'ping':
        return Response.json({ ok: true, pong: true });

      case 'licenses.list': {
        const entity = params.entity;
        if (!entity) return Response.json({ error: 'params.entity required' }, { status: 400 });
        const records = await sr.entities[entity].list('-created_date', COUNT_CAP);
        return Response.json({ ok: true, records });
      }

      case 'usage.summary': {
        // Count records of each requested entity → product-usage signal.
        const entities: string[] = Array.isArray(params.entities) ? params.entities : [];
        const counts: Record<string, number | null> = {};
        for (const e of entities) {
          try {
            const rows = await sr.entities[e].list('-created_date', COUNT_CAP);
            counts[e] = rows.length;
          } catch {
            counts[e] = null; // entity missing/inaccessible in this app
          }
        }
        return Response.json({ ok: true, counts, cap: COUNT_CAP });
      }

      case 'emails.status': {
        // Read follow-up / lifecycle email history for one tenant from the app's
        // email log entity (apps that have one). Returns [] when absent. Read-only.
        const logEntity = params.logEntity;
        const idField = params.idField;
        const id = params.id;
        if (!logEntity || !idField || !id) return Response.json({ error: 'params.logEntity/idField/id required' }, { status: 400 });
        try {
          const rows = await sr.entities[logEntity].filter({ [idField]: id });
          const records = (rows ?? []).map((r: Record<string, unknown>) => ({
            email_type: r.email_type, status: r.status, sent_at: r.sent_at, recipient_email: r.recipient_email,
          }));
          return Response.json({ ok: true, records });
        } catch (e) {
          return Response.json({ ok: true, records: [], note: (e as Error).message });
        }
      }

      case 'license.set': {
        // Mission Control writes a tenant's license (service-role, HMAC-gated).
        // MC owns the per-app field mapping and builds `patch`; optional `log`
        // appends an audit row (e.g. puntos LicenseEvent). Returns the updated row.
        const entity = params.entity;
        const id = params.id;
        const patch = params.patch;
        if (!entity || !id || !patch || typeof patch !== 'object') {
          return Response.json({ error: 'params.entity/id/patch required' }, { status: 400 });
        }
        const updated = await sr.entities[entity].update(id, patch);
        const log = params.log;
        if (log && log.entity && log.row && typeof log.row === 'object') {
          try { await sr.entities[log.entity].create(log.row); } catch { /* audit best-effort */ }
        }
        return Response.json({ ok: true, updated });
      }

      case 'emails.sendFollowup': {
        // Mission Control sends ONE renewal follow-up to a tenant (HMAC-gated,
        // service-role). MC owns the recipient + rendered content; the bridge
        // just sends via the app email integration and optionally logs it.
        const to = params.to;
        const subject = params.subject;
        const html = params.html;
        if (!to || !subject || !html) return Response.json({ error: 'params.to/subject/html required' }, { status: 400 });
        await sr.integrations.Core.SendEmail({ to, subject, body: html, from_name: 'ACACIA' });
        const sent_at = new Date().toISOString();
        const log = params.log;
        if (log && log.entity && log.row && typeof log.row === 'object') {
          try { await sr.entities[log.entity].create({ ...log.row, sent_at }); } catch { /* audit best-effort */ }
        }
        return Response.json({ ok: true, sent_at, recipient: to });
      }

      case 'tenants.contacts': {
        // Resolve recipient contacts for the app's tenants (read-only). MC passes
        // the per-app recipient spec: emails from fields on the license record, or
        // from a related entity (membership / school). Used to target campaigns.
        const entity = params.entity;
        const r = params.recipient || {};
        if (!entity) return Response.json({ error: 'params.entity required' }, { status: 400 });
        const records = await sr.entities[entity].list('-created_date', COUNT_CAP);
        const contacts = [];
        for (const rec of records) {
          let email = '';
          if (Array.isArray(r.fields)) {
            for (const f of r.fields) { if (rec[f]) { email = String(rec[f]); break; } }
          }
          if (!email && r.related && r.related.entity && r.related.keyField && r.related.emailField) {
            try {
              const key = r.related.keyFromRecord ? rec[r.related.keyFromRecord] : rec.id;
              const rows = await sr.entities[r.related.entity].filter({ [r.related.keyField]: key });
              // When roles are required, ONLY accept a row with an allowed role —
              // never fall back to an arbitrary (wrong-role) contact.
              let pick;
              if (Array.isArray(r.related.roles) && r.related.roleField) {
                pick = rows.find((x) => r.related.roles.includes(x[r.related.roleField])) || null;
              } else {
                pick = rows[0] || null;
              }
              if (pick) email = String(pick[r.related.emailField] || '');
            } catch { /* skip this record */ }
          }
          contacts.push({ id: rec.id, name: (r.nameField ? rec[r.nameField] : rec.name) || null, email: email || null });
        }
        return Response.json({ ok: true, contacts });
      }

      case 'usage.byTenant': {
        // Per-tenant consumption: count records of an entity grouped by its tenant
        // FK field. Privacy: returns ONLY { tenant id, count } — no record data.
        const entity = params.entity;
        const field = params.tenantField;
        if (!entity || !field) return Response.json({ error: 'params.entity/tenantField required' }, { status: 400 });
        try {
          const rows = await sr.entities[entity].list('-created_date', COUNT_CAP);
          const counts: Record<string, number> = {};
          for (const r of rows) {
            const k = r?.[field];
            if (k) counts[String(k)] = (counts[String(k)] ?? 0) + 1;
          }
          const top = Object.entries(counts)
            .map(([id, count]) => ({ id, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 50);
          return Response.json({ ok: true, entity, field, top, capped: rows.length >= COUNT_CAP });
        } catch (e) {
          return Response.json({ ok: true, top: [], note: (e as Error).message });
        }
      }

      case 'tickets.list': {
        // List an app's support tickets (service-role). MC owns the per-app field
        // mapping; this returns the raw records. Read-only.
        const entity = params.entity;
        if (!entity) return Response.json({ error: 'params.entity required' }, { status: 400 });
        const records = await sr.entities[entity].list(params.order || '-created_date', COUNT_CAP);
        return Response.json({ ok: true, records });
      }

      case 'tickets.thread': {
        // Messages of one ticket, for apps with a SEPARATE message entity
        // (puntos/liuma/ctrlhq). Rumbo stores the thread inline so MC never calls this.
        const messageEntity = params.messageEntity;
        const fkField = params.fkField;
        const ticketId = params.ticketId;
        if (!messageEntity || !fkField || !ticketId) return Response.json({ error: 'params.messageEntity/fkField/ticketId required' }, { status: 400 });
        const records = await sr.entities[messageEntity].filter({ [fkField]: ticketId });
        return Response.json({ ok: true, records });
      }

      case 'tickets.update': {
        // Reply to and/or change the status of a ticket (service-role, HMAC-gated).
        // MC owns the per-app shape: optionally create a message row (separate-entity
        // apps), optionally append to an inline array (rumbo `responses`), and patch
        // the ticket (status / activity / counters). Returns the updated row.
        const entity = params.entity;
        const id = params.id;
        if (!entity || !id) return Response.json({ error: 'params.entity/id required' }, { status: 400 });
        if (params.messageEntity && params.message && typeof params.message === 'object') {
          await sr.entities[params.messageEntity].create(params.message);
        }
        const patch = (params.patch && typeof params.patch === 'object') ? { ...params.patch } : {};
        if (params.appendField && params.appendItem && typeof params.appendItem === 'object') {
          // Append to an inline array on the ticket. Read the LIVE array first so a
          // concurrent customer reply isn't lost; fall back to MC's snapshot.
          let arr = null;
          try {
            const cur = await sr.entities[entity].get(id);
            if (Array.isArray(cur?.[params.appendField])) arr = cur[params.appendField];
          } catch { /* get unavailable — use the snapshot below */ }
          if (arr === null && Array.isArray(params.currentArray)) arr = params.currentArray;
          if (arr === null) arr = [];
          patch[params.appendField] = [...arr, params.appendItem];
        }
        const updated = Object.keys(patch).length ? await sr.entities[entity].update(id, patch) : null;
        return Response.json({ ok: true, updated });
      }

      case 'sessions.list': {
        // List this app's end-user sessions for Mission Control (service-role).
        // MC computes idle/state from last_active_at; here we just return the raw
        // rows, most-recently-active first. Read-only.
        const entity = params.entity;
        if (!entity) return Response.json({ error: 'params.entity required' }, { status: 400 });
        const records = await sr.entities[entity].list('-last_active_at', COUNT_CAP);
        return Response.json({ ok: true, records });
      }

      case 'sessions.revoke': {
        // Force-logout: mark the given sessions revoked (service-role, HMAC-gated).
        // The app's client checks its own row each heartbeat and logs out when
        // revoked_at is set. `actorEmail` is recorded for the in-app audit trail.
        const entity = params.entity;
        const ids = Array.isArray(params.ids) ? params.ids : [];
        const revokedBy = typeof params.actorEmail === 'string' ? params.actorEmail : null;
        if (!entity || ids.length === 0) return Response.json({ error: 'params.entity/ids required' }, { status: 400 });
        const revoked_at = new Date().toISOString();
        let revoked = 0;
        for (const id of ids) {
          try { await sr.entities[entity].update(id, { revoked_at, revoked_by: revokedBy }); revoked++; } catch { /* skip missing */ }
        }
        return Response.json({ ok: true, revoked });
      }

      // Fase 6 — writes land here, e.g. 'license.activate' / 'license.suspend'.

      default:
        return Response.json({ error: `unknown action: ${action}` }, { status: 400 });
    }
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
});
