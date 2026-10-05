// Layout scan: overlapping controls, horizontal overflow, clipped text and
// controls covered by fixed chrome (theme switcher, mobile header), per
// viewport. Starts Vite itself and fulfils every /api/ request locally.
// Usage: node scripts/layout-scan.mjs [--width 320,390,...] [--shots dir]
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer as http } from 'node:http';
import { extname, join } from 'node:path';

const args = process.argv.slice(2);
const argOf = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const VIEWPORTS = (argOf('--width') || '320x700,390x844,768x1024,834x1194,1024x768,1024x1366,1440x900')
  .split(',').map((s) => { const [w, h] = s.split('x').map(Number); return { w, h: h || 800 }; });
const SHOTS = argOf('--shots');

const ME = { id: 'u1', email: 'dueno@example.invalid', full_name: 'Dueño Prueba', role: 'business_admin', business_id: 'b1' };
const BIZ = { id: 'b1', name: 'Restaurante de prueba con un nombre bastante largo S.A. de C.V.', billing_status: process.env.BILLING || 'active', invite_code: 'ABC123', license_plan: 'pro' };
const D = (i) => `2026-09-${String(1 + (i % 28)).padStart(2, '0')}`;
const rows = (n, f) => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, business_id: 'b1', date: D(i), ...f(i) }));
const DB = {
  Business: [BIZ],
  Income: rows(8, (i) => ({ amount: 1234.5 * (i + 1), payment_method: 'Tarjeta de crédito', sale_type: 'Mostrador', description: 'Venta de prueba con descripción larga '.repeat(2) })),
  Expense: rows(8, (i) => ({ amount: 999.99 * (i + 1), supplier_name: 'Proveedor con nombre muy largo SA de CV', category: 'Insumos', invoice_number: 'F-' + i, invoice_status: i % 2 ? 'pendiente' : 'recibida' })),
  Payroll: rows(6, (i) => ({ collaborator: 'Colaborador Nombre Largo', base_salary: 5000, overtime_hours: 2, overtime_pay: 200, vacation_days: 1, absences: 0, deductions: 100, total: 5100 })),
  TeamConsumption: rows(6, (i) => ({ collaborator: 'Colaborador Largo', dish: 'Platillo del día', amount: 85 + i })),
  Collaborator: [{ id: 'c1', name: 'Colaborador Nombre Largo', business_id: 'b1' }, { id: 'c2', name: 'Otra Persona', business_id: 'b1' }],
  PaymentMethod: [{ id: 'p1', name: 'Efectivo' }, { id: 'p2', name: 'Tarjeta' }],
  SaleType: [{ id: 's1', name: 'Mostrador' }],
  Supplier: [{ id: 'su1', name: 'Proveedor Uno' }],
  User: [ME, { id: 'u2', email: 'personal.con.un.correo.muy.largo@example.invalid', full_name: 'Persona Staff', role: 'staff', business_id: 'b1' }],
  SupportTicket: [{ id: 't1', subject: 'Un asunto de soporte bastante largo para probar', status: 'abierto', message: 'Mensaje '.repeat(30), created_date: '2026-09-01T10:00:00' }],
  PermissionProfile: [],
};

async function mock(ctx) {
  // Nothing external (fonts, analytics) may stall the page in a sandbox.
  await ctx.route((u) => !/^(localhost|127\.0\.0\.1)$/.test(u.hostname), (r) => r.abort());
  await ctx.route((u) => u.pathname.startsWith('/api/') || /socket\.io/.test(u.href), async (route) => {
    const req = route.request(); const url = new URL(req.url()); const p = url.pathname;
    const json = (x) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) });
    if (/socket\.io/.test(url.href)) return route.abort();
    if (p.includes('public-settings')) return json({ id: 'mockapp', public_settings: {} });
    if (p.endsWith('/entities/User/me')) return json(ME);
    const m = p.match(/\/entities\/(\w+)(?:\/(\w+))?$/);
    if (m) {
      const list = DB[m[1]] || [];
      if (m[2]) return json(list.find((r) => r.id === m[2]) || {});
      return json(req.method() === 'GET' ? list : { id: 'x' });
    }
    if (/\/functions\/manage-member/.test(p)) return json({ ok: true, requests: [{ id: 'q1', email: 'solicitante@example.invalid', full_name: 'Solicitante', requested_at: '2026-09-01' }], users: [] });
    return json({ ok: true });
  });
}

async function scan(page) {
  return page.evaluate(() => {
    const SEL = 'a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=combobox], [role=switch], [role=checkbox]';
    const label = (el) => `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.name || '').replace(/\s+/g, ' ').trim().slice(0, 30)}"`;
    const vis = (el) => { const r = el.getBoundingClientRect(); if (!r.width || !r.height) return false; const c = getComputedStyle(el); return c.visibility !== 'hidden' && c.display !== 'none' && c.opacity !== '0' && !el.closest('[aria-hidden=true]'); };
    const menuOpen = !!document.querySelector('div.fixed.inset-0.z-30');
    // A closed drawer sits off-screen; an open one dims the page, so only the
    // drawer and the fixed header are checked then.
    // True when the point (x, y) of el is cut away by an overflow-clipping ancestor.
    const clipped = (el, x, y) => {
      for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
        const c = getComputedStyle(n);
        if (c.overflowX === 'visible' && c.overflowY === 'visible') continue;
        const r = n.getBoundingClientRect();
        if (x < r.left || x > r.right || y < r.top || y > r.bottom) return true;
      }
      return false;
    };
    const els = [...document.querySelectorAll(SEL)].filter(vis).filter((el) => el.getBoundingClientRect().right > 0)
      .filter((el) => !menuOpen || el.closest('aside, div.lg\\:hidden.fixed'));
    const out = { overlap: [], covered: [], overflow: [], clipped: [] };
    const doc = document.documentElement;
    if (doc.scrollWidth > innerWidth + 1) out.overflow.push(`document ${doc.scrollWidth}>${innerWidth}`);
    for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
      const a = els[i], b = els[j];
      if (a.contains(b) || b.contains(a)) continue;
      if (a.closest('label') && a.closest('label') === b.closest('label')) continue;
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (w > 3 && h > 3) {
        // Only a real clash when the contested spot is actually showing one of them
        // (an input scrolled out of a dialog's inner scroller is clipped, not overlapped).
        const px = Math.max(ra.left, rb.left) + w / 2, py = Math.max(ra.top, rb.top) + h / 2;
        if (clipped(a, px, py) || clipped(b, px, py)) continue;
        const at = document.elementFromPoint(px, py);
        if (!at || !(a.contains(at) || b.contains(at) || at.contains(a) || at.contains(b))) continue;
        // content scrolling under the fixed mobile header is normal
        if (at.closest('div.lg\\:hidden.fixed') && Math.min(ra.top, rb.top) < 56) continue;
      }
      if (w > 3 && h > 3) out.overlap.push(`${label(a)} x ${label(b)} (${Math.round(w)}x${Math.round(h)})`);
    }
    for (const el of els) {
      const r = el.getBoundingClientRect();
      // inside a scroll container (tables) horizontal clipping is expected
      let sc = el.parentElement, scrolled = false;
      while (sc) { const o = getComputedStyle(sc).overflowX; if ((o === 'auto' || o === 'scroll') && sc.scrollWidth > sc.clientWidth) { scrolled = true; break; } sc = sc.parentElement; }
      if (!scrolled && (r.right > innerWidth + 1 || r.left < -1)) out.overflow.push(`${label(el)} ${Math.round(r.left)}..${Math.round(r.right)}`);
      const fixed = (() => { let n = el; while (n) { if (getComputedStyle(n).position === 'fixed') return true; n = n.parentElement; } return false; })();
      if (fixed || r.bottom < 0 || r.top > innerHeight || r.top < 56) continue; // under the fixed header while scrolling: normal
      const cx = Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1), cy = Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1);
      const at = document.elementFromPoint(cx, cy);
      if (at && at !== el && !el.contains(at) && !at.contains(el) && !el.closest('label')?.contains(at) && !at.closest('[role=region], [role=status], [data-sonner-toaster]')) out.covered.push(`${label(el)} by ${at.tagName.toLowerCase()}${at.className && typeof at.className === 'string' ? '.' + at.className.split(' ')[0] : ''}`);
    }
    for (const el of document.querySelectorAll('button, a, label, th, h1, h2, h3, p, span')) {
      if (!vis(el) || el.children.length > 2 || el.classList.contains('sr-only') || el.closest('[aria-live], [role=status], [data-radix-toast-announce-exclude]')) continue;
      const c = getComputedStyle(el);
      if (c.overflow === 'hidden' && c.textOverflow !== 'ellipsis' && el.scrollWidth > el.clientWidth + 2 && el.textContent.trim()) out.clipped.push(`${label(el)} ${el.scrollWidth}>${el.clientWidth}`);
    }
    return out;
  });
}

const PAGES = ['/', '/ingresos', '/egresos', '/nomina', '/consumos-equipo', '/configuracion', '/cuenta', '/soporte', '/permisos'];
// Serves the built dist/ (run `npm run build` first); lighter and steadier
// than the dev server, and it is what ships.
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' };
const server = http(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  let file = join('dist', path);
  let body = await readFile(file).catch(() => null);
  if (!body || path === '/') { file = join('dist', 'index.html'); body = await readFile(file); }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
  res.end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ['--disable-dev-shm-usage'] });
if (SHOTS) await mkdir(SHOTS, { recursive: true });
let total = 0;
for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, hasTouch: vp.w < 1440, isMobile: vp.w < 900, locale: 'es-MX' });
  await ctx.addInitScript(() => { localStorage.setItem('base44_access_token', 'tok'); localStorage.setItem('base44_app_id', 'mockapp'); });
  await mock(ctx);
  const page = await ctx.newPage();
  for (const path of PAGES) {
    await page.goto(base + path, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(500);
    const states = [['', null]];
    if (vp.w < 1024) states.push(['menu', async () => { await page.locator('div.lg\\:hidden button').first().click(); await page.waitForTimeout(400); }]);
    states.push(['dialog', async () => { const b = page.getByRole('button', { name: /nuevo|nueva|agregar|registrar/i }).first(); if (await b.count()) { await b.click(); await page.waitForTimeout(400); } else throw new Error('none'); }]);
    const tabs = await page.getByRole('tab').count();
    for (let t = 1; t < tabs; t++) states.push([`tab${t}`, async () => { await page.getByRole('tab').nth(t).click(); await page.waitForTimeout(400); }]);
    for (const [name, act] of states) {
      if (act) { await page.goto(base + path, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(400); try { await act(); } catch { continue; } }
      if (!act || name.startsWith('tab')) await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const r = await scan(page);
      const n = Object.values(r).reduce((s, a) => s + a.length, 0);
      if (SHOTS && (n || process.env.ALL_SHOTS)) await page.screenshot({ path: `${SHOTS}/${vp.w}x${vp.h}-${path.replace(/\W/g, '') || 'home'}-${name || 'page'}.png` });
      if (n) { total += n; console.log(`\n[${vp.w}x${vp.h}] ${path} ${name}`); for (const [k, a] of Object.entries(r)) for (const x of [...new Set(a)].slice(0, 8)) console.log(`  ${k}: ${x}`); }
    }
  }
  await ctx.close();
}
await browser.close(); server.close();
console.log(`\nTOTAL findings: ${total}`);
process.exit(total ? 1 : 0);
