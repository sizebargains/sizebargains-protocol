// Static build: src/ + public/ -> dist/. Usage: node scripts/build.mjs [--register path] [--out dir]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const STATES = ['stated', 'absent', 'unconfirmed'];
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const ICONS = {
  x: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
  github: '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"/></svg>',
};
const COPY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/></svg>';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function validate(reg) {
  for (const [key, rec] of Object.entries(reg)) {
    if (!STATES.includes(rec.state)) throw new Error(`register.${key}: bad state "${rec.state}"`);
    if (rec.state !== 'stated') {
      for (const bad of ['value', 'url', 'href', 'rpc', 'boosts', 'pairs'])
        if (bad in rec) throw new Error(`register.${key}: ${rec.state} record must not carry "${bad}"`);
    }
  }
  const need = ['chain', 'ca', 'x', 'github', 'market'];
  for (const k of need) if (!reg[k]) throw new Error(`register.${k} missing`);
  if (reg.ca.state === 'stated' && !B58.test(reg.ca.value || '')) throw new Error('register.ca: not a Solana address');
  if (reg.x.state === 'stated') hostHandle(reg.x.url, ['x.com', 'twitter.com']);
  if (reg.github.state === 'stated') hostHandle(reg.github.url, ['github.com']);
  if (reg.market.state === 'stated' && !(reg.market.boosts && reg.market.pairs)) throw new Error('register.market: sources missing');
}

// link rule: store the URL, derive the handle
export function hostHandle(url, hosts) {
  const u = new URL(url);
  const host = u.hostname.replace(/^www\./, '');
  if (u.protocol !== 'https:' || !hosts.includes(host)) throw new Error(`unexpected link host ${u.hostname}`);
  const seg = u.pathname.split('/').filter(Boolean);
  if (!seg.length) throw new Error(`no handle in ${url}`);
  return seg[0];
}

function renderSocial(reg) {
  const one = (key, label, hosts) => {
    const rec = reg[key];
    if (rec.state === 'stated') {
      const handle = hostHandle(rec.url, hosts);
      return `<a class="icon" data-record="${key}" data-state="stated" href="${esc(rec.url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(label)}: ${esc(handle)}">${ICONS[key]}</a>`;
    }
    return `<span class="icon is-inert" data-record="${key}" data-state="${rec.state}" role="img" aria-disabled="true" aria-label="${esc(label)}, pending">${ICONS[key]}</span>`;
  };
  return `<div class="social" aria-label="Social links">${one('x', 'X', ['x.com', 'twitter.com'])}${one('github', 'GitHub', ['github.com'])}</div>`;
}

function renderCa(reg) {
  const rec = reg.ca;
  if (rec.state === 'stated') {
    return `<section class="ca" id="ca" data-record="ca" data-state="stated" aria-label="Contract address">
    <span class="ca-label">${esc(rec.label)}</span>
    <button class="ca-value" type="button" data-copy="${esc(rec.value)}" aria-label="Copy contract address"><code>${esc(rec.value)}</code><span class="ca-hint">${COPY_ICON}<span class="ca-hint-text">Copy</span></span></button>
    <span class="sr" role="status" aria-live="polite" id="ca-live"></span>
  </section>`;
  }
  return `<section class="ca" id="ca" data-record="ca" data-state="${rec.state}" aria-label="Contract address">
    <span class="ca-label">${esc(rec.label)}</span>
    <span class="ca-value is-pending" aria-disabled="true">pending</span>
  </section>`;
}

function renderFacts(reg) {
  const li = (key, label, body, inert) =>
    `<li data-record="${key}" data-state="${reg[key].state}"><span class="k">${esc(label)}</span><span class="v${inert ? ' is-pending' : ''}">${body}</span></li>`;
  const out = [];
  const c = reg.chain;
  out.push(c.state === 'stated'
    ? li('chain', c.label, `${esc(c.value)}<small>RPC ${esc(new URL(c.rpc).host)} &middot; ${esc(c.source)} &middot; ${esc(c.scope)}</small>`)
    : li('chain', c.label, 'pending', true));
  out.push(reg.ca.state === 'stated' ? li('ca', reg.ca.label, esc(reg.ca.value)) : li('ca', reg.ca.label, 'pending', true));
  for (const [key, label, hosts] of [['x', 'X', ['x.com', 'twitter.com']], ['github', 'GitHub', ['github.com']]]) {
    const r = reg[key];
    out.push(r.state === 'stated'
      ? li(key, label, `<a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">@${esc(hostHandle(r.url, hosts))}</a>`)
      : li(key, label, 'pending', true));
  }
  return out.join('\n          ');
}

// browser-side projection: state plus value/url only, never dates or notes
export function project(reg) {
  const p = {};
  for (const [k, r] of Object.entries(reg)) {
    p[k] = { state: r.state };
    if (r.state === 'stated') for (const f of ['value', 'url', 'rpc', 'boosts', 'pairs']) if (r[f]) p[k][f] = r[f];
  }
  return p;
}

function tokenHex(css) {
  const m = {};
  for (const x of css.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)) m[x[1]] = x[2];
  return m;
}

function faviconSvg(hex) {
  const cells = JSON.parse(fs.readFileSync(path.join(root, 'public/favicon.cells.json'), 'utf8'));
  const map = { deep: hex['green-deep'], dark: hex['green-dark'], mid: hex.green, lime: hex.lime, cream: hex.cream, shade: hex.shade };
  const rects = [];
  cells.rows.forEach((runs, y) => runs.forEach(([k, x, l]) => rects.push(`<rect x="${x}" y="${y}" width="${l}" height="1" fill="${map[k]}"/>`)));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32" shape-rendering="crispEdges"><rect width="32" height="32" rx="6" fill="${hex.bg}"/>${rects.join('')}</svg>\n`;
}

export function build({ registerPath, outDir }) {
  const reg = JSON.parse(fs.readFileSync(registerPath, 'utf8'));
  validate(reg);
  fs.rmSync(outDir, { recursive: true, force: true });
  for (const d of ['css', 'js', 'assets', 'fonts']) fs.mkdirSync(path.join(outDir, d), { recursive: true });

  const tokens = fs.readFileSync(path.join(root, 'src/tokens.css'), 'utf8');
  const hex = tokenHex(tokens);
  fs.writeFileSync(path.join(outDir, 'css/tokens.css'), tokens);
  fs.copyFileSync(path.join(root, 'src/styles.css'), path.join(outDir, 'css/app.css'));
  for (const f of fs.readdirSync(path.join(root, 'src/js'))) fs.copyFileSync(path.join(root, 'src/js', f), path.join(outDir, 'js', f));

  // logo: copied explicitly, referenced by relative path in index.html
  for (const f of ['logo-512.png', 'logo-128.png']) {
    const from = path.join(root, 'public', f);
    if (!fs.existsSync(from)) throw new Error(`missing ${f}; run scripts/prep-assets.py`);
    fs.copyFileSync(from, path.join(outDir, 'assets', f));
  }
  for (const f of fs.readdirSync(path.join(root, 'public/fonts'))) fs.copyFileSync(path.join(root, 'public/fonts', f), path.join(outDir, 'fonts', f));
  fs.writeFileSync(path.join(outDir, 'favicon.svg'), faviconSvg(hex));

  const slots = {
    theme: `<meta name="theme-color" content="${hex.bg}">`,
    social: renderSocial(reg),
    ca: renderCa(reg),
    facts: renderFacts(reg),
    register: JSON.stringify(project(reg)),
  };
  let html = fs.readFileSync(path.join(root, 'src/index.html'), 'utf8');
  for (const [k, v] of Object.entries(slots)) html = html.replace(`<!--@${k}-->`, () => v);
  if (/<!--@/.test(html)) throw new Error('unfilled slot in index.html');
  fs.writeFileSync(path.join(outDir, 'index.html'), html);
  return { reg, outDir };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? path.resolve(process.argv[i + 1]) : d; };
  const out = arg('--out', path.join(root, 'dist'));
  build({ registerPath: arg('--register', path.join(root, 'src/register.json')), outDir: out });
  console.log(`built -> ${path.relative(root, out) || '.'}`);
}
