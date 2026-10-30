// Gates: build, then check the build and the repo. Exit 0 only when every gate passes.
// Mutation anchors read the current register at runtime; each record is forced into BOTH branches explicitly,
// so the checks hold whatever state the record is in today.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, project } from './build.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = (...a) => path.join(root, ...a);
const read = (f) => fs.readFileSync(f, 'utf8');
const REG = P('src/register.json');
const TMP = P('.gates-tmp');

const results = [];
let group = '';
const gate = async (name, fn) => {
  try { await fn(); results.push({ group, name, ok: true }); }
  catch (e) { results.push({ group, name, ok: false, why: e.message }); }
};
const ok = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

// ---------- helpers ----------
const listFiles = (dir, acc = []) => {
  for (const n of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, n.name);
    n.isDirectory() ? listFiles(f, acc) : acc.push(f);
  }
  return acc;
};
const TEXT_EXT = new Set(['.html', '.css', '.js', '.svg', '.json', '.md', '.mjs', '.txt', '.py']);
const isText = (f) => TEXT_EXT.has(path.extname(f)) || path.basename(f) === 'LICENSE';

const B58_RUN = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
const EVM_RUN = /0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g;
// address-shaped: base58 run that mixes digits, upper and lower case (rules out plain identifiers), or 0x + 40 hex
export function scanAddresses(text) {
  const hits = new Set();
  for (const m of text.matchAll(B58_RUN)) if (/\d/.test(m[0]) && /[A-Z]/.test(m[0]) && /[a-z]/.test(m[0])) hits.add(m[0]);
  for (const m of text.matchAll(EVM_RUN)) hits.add(m[0]);
  return [...hits];
}
// stated registry values are allowed; the CA record is exempt by name
export function unknownAddresses(text, reg) {
  const allowed = new Set();
  for (const r of Object.values(reg)) if (r.state === 'stated') for (const v of Object.values(r)) if (typeof v === 'string') allowed.add(v);
  return scanAddresses(text).filter((a) => !allowed.has(a));
}

function variant(key, state, extra = {}) {
  const reg = JSON.parse(read(REG));
  const rec = reg[key];
  const keep = { label: rec.label, recorded: rec.recorded };
  reg[key] = state === 'stated' ? { ...keep, state, ...extra } : { ...keep, state };
  const dir = path.join(TMP, `${key}-${state}-${crypto.randomBytes(3).toString('hex')}`);
  const regPath = dir + '.json';
  fs.mkdirSync(TMP, { recursive: true });
  fs.writeFileSync(regPath, JSON.stringify(reg));
  build({ registerPath: regPath, outDir: dir });
  return { dir, reg, html: read(path.join(dir, 'index.html')) };
}

const TEST_CA = 'So11111111111111111111111111111111111111112';
const TEST_X = 'https://x.com/size_test';
const TEST_GH = 'https://github.com/size-test/size';
const tagOf = (html, key) => (html.match(new RegExp(`<(?:a|span|section|li)\\b[^>]*data-record="${key}"[^>]*>`)) || [])[0];
const slice = (html, from, to) => html.slice(html.indexOf(from), html.indexOf(to));

const textLines = (html) => {
  const body = html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ');
  const attrs = [...body.matchAll(/\b(?:aria-label|alt|title|placeholder|content)="([^"]*)"/g)].map((m) => m[1]);
  const nodes = body.replace(/<[^>]+>/g, '\n').split('\n').map((s) => s.trim()).filter(Boolean);
  return [...nodes, ...attrs].map((s) => s.replace(/&mdash;|&hellip;|&nbsp;|&middot;/g, ' ').replace(/&amp;/g, '&'));
};
const words = (s) => s.toLowerCase().match(/[a-z0-9$%]+/g) || [];
const bigrams = (line) => { const w = words(line); const out = []; for (let i = 0; i < w.length - 1; i++) out.push(`${w[i]} ${w[i + 1]}`); return out; };

// =====================================================================
const cur = JSON.parse(read(REG));
fs.rmSync(TMP, { recursive: true, force: true });
const built = build({ registerPath: REG, outDir: P('dist') });
const dist = P('dist');
const html = read(path.join(dist, 'index.html'));
const css = read(path.join(dist, 'css/app.css'));
const tokens = read(P('src/tokens.css'));
const jsFiles = fs.readdirSync(P('src/js')).map((f) => [f, read(P('src/js', f))]);
const allJs = jsFiles.map(([, s]) => s).join('\n');

group = 'register';
await gate('every record has a valid state', () => {
  for (const [k, r] of Object.entries(cur)) ok(['stated', 'absent', 'unconfirmed'].includes(r.state), `${k}: ${r.state}`);
});
await gate('inert records carry no value or url', () => {
  for (const [k, r] of Object.entries(cur)) if (r.state !== 'stated')
    for (const f of ['value', 'url', 'href', 'rpc', 'boosts', 'pairs']) ok(!(f in r), `${k} has ${f}`);
});
await gate('build refuses an inert record that carries a value', () => {
  const bad = { ...cur, x: { state: 'absent', label: 'X', url: 'https://x.com/nope' } };
  fs.mkdirSync(TMP, { recursive: true });
  const f = path.join(TMP, 'bad.json'); fs.writeFileSync(f, JSON.stringify(bad));
  let threw = false;
  try { build({ registerPath: f, outDir: path.join(TMP, 'bad-out') }); } catch { threw = true; }
  ok(threw, 'build accepted a poisoned record');
});
await gate('chain record states Solana, rpc, source, scope', () => {
  const c = cur.chain;
  eq(c.state, 'stated', 'chain state'); eq(c.value, 'Solana', 'chain'); eq(c.rpc, 'https://solana-rpc.publicnode.com', 'rpc');
  eq(c.source, 'client statement', 'source'); eq(c.scope, 'batch-level', 'scope');
});
await gate('dates live in register.json only, never in the page projection', () => {
  ok(Object.values(cur).every((r) => 'recorded' in r), 'register keeps dates as data');
  ok(!/recorded/.test(html), 'projection leaked a date field');
  ok(!JSON.stringify(project(cur)).includes('2026'), 'projection holds a year');
});

group = 'build output';
await gate('npm run build output is dist/ with index.html', () => ok(fs.existsSync(P('dist/index.html')), 'no dist/index.html'));
await gate('logo is copied into dist/assets and is a valid RGBA PNG', () => {
  for (const f of ['logo-512.png', 'logo-128.png']) {
    const b = fs.readFileSync(path.join(dist, 'assets', f));
    eq(b.subarray(1, 4).toString(), 'PNG', `${f} signature`);
    eq(b.readUInt32BE(16), b.readUInt32BE(20), `${f} square`);
    eq(b[25], 6, `${f} colour type`);
  }
});
await gate('index.html references the logo by correct relative path', () => {
  ok(/src="assets\/logo-128\.png"/.test(html) && /src="assets\/logo-512\.png"/.test(html), 'logo not referenced');
  ok(!/(?:src|href)="\/(?!\/)/.test(html), 'root-absolute path found');
});
await gate('every local reference resolves inside dist', () => {
  const refs = [...html.matchAll(/(?:src|href)="([^"#:]+)"/g)].map((m) => m[1]);
  ok(refs.length > 6, 'too few refs found');
  for (const r of refs) ok(fs.existsSync(path.join(dist, r)), `missing ${r}`);
  for (const m of css.matchAll(/url\("?([^")]+)"?\)/g)) ok(fs.existsSync(path.join(dist, 'css', m[1])), `css missing ${m[1]}`);
  for (const [f, s] of jsFiles) for (const m of s.matchAll(/from '(\.\/[^']+)'/g)) ok(fs.existsSync(path.join(dist, 'js', m[1])), `${f} imports ${m[1]}`);
});
await gate('dist holds site files only (no repo docs, no register, no maps)', () => {
  for (const f of listFiles(dist)) {
    const rel = path.relative(dist, f).replace(/\\/g, '/');
    ok(!/\.(md|map|json|py|mjs)$/.test(rel) && !/^(LICENSE|docs\/|src\/)/.test(rel), `unexpected ${rel}`);
  }
});
await gate('favicon is a 32x32 SVG with no comments and no double hyphen, linked from the page', () => {
  const s = read(path.join(dist, 'favicon.svg'));
  ok(/viewBox="0 0 32 32"/.test(s) && /width="32"/.test(s) && /height="32"/.test(s), 'not 32x32');
  ok(!s.includes('<!--') && !s.includes('--'), 'comment or double hyphen');
  ok(/<link rel="icon" type="image\/svg\+xml" href="favicon\.svg">/.test(html), 'not linked');
  const hexes = new Set([...tokens.matchAll(/#[0-9a-f]{6}/gi)].map((m) => m[0].toLowerCase()));
  for (const m of s.matchAll(/fill="(#[0-9a-f]{6})"/gi)) ok(hexes.has(m[1].toLowerCase()), `favicon colour ${m[1]} not in tokens`);
});

group = 'palette';
await gate('colour literals live in src/tokens.css only', () => {
  const HEX = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/;
  const FN = /\b(?:rgba?|hsla?|oklch|oklab)\(/;
  for (const [n, s] of [['styles.css', read(P('src/styles.css'))], ['index.html', read(P('src/index.html'))], ...jsFiles]) {
    ok(!HEX.test(s) && !FN.test(s), `literal colour in ${n}`);
  }
});
await gate('every token hex is a real pixel at its stated coordinate; fringe stays bright (premultiplied resize)', () => {
  const o = JSON.parse(execFileSync('python', ['-I', P('scripts/verify-palette.py')], { cwd: root }).toString());
  eq(o.bad.length, 0, `pixel mismatches ${JSON.stringify(o.bad)}`);
  eq(o.checked, o.declared, 'tokens without provenance');
  ok(o.source_pure_black_transparent > 0, 'expected pure-black transparent source');
  ok(o.fringe_mean_max_channel > 90, `fringe too dark (${o.fringe_mean_max_channel})`);
});

group = 'social';
for (const [key, url, host] of [['x', TEST_X, 'size_test'], ['github', TEST_GH, 'size-test']]) {
  await gate(`${key}: absent renders an inert icon, stated renders a link (state-independent anchor)`, () => {
    for (const st of ['absent', 'unconfirmed']) {
      const v = variant(key, st);
      const t = tagOf(v.html, key);
      ok(t && t.startsWith('<span') && !/href=/.test(t) && /aria-disabled="true"/.test(t) && /is-inert/.test(t), `${key} ${st}: not inert: ${t}`);
      ok(!v.html.includes(url), `${key} ${st}: url leaked`);
    }
    const s = variant(key, 'stated', { url });
    const t = tagOf(s.html, key);
    ok(t && t.startsWith('<a') && t.includes(`href="${url}"`) && /rel="noopener noreferrer"/.test(t), `${key}: link missing: ${t}`);
    ok(t.includes(host), `${key}: handle not derived from url`);
  });
}
await gate('both icons are in the header, last, icon-only, present at every breakpoint', () => {
  const head = slice(html, '<header', '</header>');
  ok(head.indexOf('data-record="x"') > head.indexOf('feed-pill') && head.indexOf('data-record="github"') > head.indexOf('data-record="x"'), 'order');
  ok(head.trimEnd().endsWith('</div>') || /<\/div>\s*$/.test(head), 'social is not the last header item');
  const soc = slice(head, '<div class="social"', '</header>' === '' ? '' : head.length ? '</div>' : '');
  const txt = head.slice(head.indexOf('<div class="social"')).replace(/<[^>]+>/g, '').trim();
  eq(txt, '', 'icons carry visible text');
  ok(!/\.social[^{]*\{[^}]*display:\s*none/.test(css) && !/\.icon[^{]*\{[^}]*display:\s*none/.test(css), 'icon hidden by css');
  ok(/\.social \.icon \{[^}]*width: var\(--tap\)[^}]*height: var\(--tap\)/.test(css), 'icon not 44px');
  ok(soc !== undefined, 'x');
});
await gate('official X mark and GitHub octicon paths are used', () => {
  ok(html.includes('M18.244 2.25h3.308l-7.227 8.26'), 'X path');
  ok(html.includes('M8 0c4.42 0 8 3.58 8 8a8.013 8.013'), 'octicon path');
});

group = 'contract slot';
await gate('slot is above the content, sticky, large, full width text', () => {
  ok(html.indexOf('data-record="ca"') < html.indexOf('<main'), 'ca after main');
  ok(/\.ca \{[^}]*position: sticky/.test(css), 'not sticky');
  ok(/\.ca-value \{[^}]*font-size: 1rem/.test(css) && /\.ca-value \{ font-size: 1\.25rem/.test(css), 'font not large');
});
await gate('absent/unconfirmed: inert, label + pending only, no address, no copy handler', () => {
  for (const st of ['absent', 'unconfirmed']) {
    const v = variant('ca', st);
    const sec = slice(v.html, '<section class="ca"', '</section>');
    ok(/data-state="(absent|unconfirmed)"/.test(sec) && sec.includes('pending') && !/data-copy|<button|<code|href=/.test(sec), `${st}: not inert`);
    eq(unknownAddresses(v.html, v.reg).length, 0, `${st}: stray address`);
  }
});
await gate('stated: full address, one-tap copy control, live feedback region', () => {
  const v = variant('ca', 'stated', { value: TEST_CA });
  const sec = slice(v.html, '<section class="ca"', '</section>');
  ok(sec.includes(`data-copy="${TEST_CA}"`) && sec.includes(`<code>${TEST_CA}</code>`), 'address missing');
  ok(/<button class="ca-value" type="button"/.test(sec) && /aria-live="polite"/.test(sec), 'control');
  ok(/is-copied/.test(allJs) && /Copied/.test(allJs) && /navigator\.clipboard\.writeText/.test(allJs), 'copy feedback missing');
});
await gate('a malformed CA is refused at build', () => {
  const reg = JSON.parse(read(REG)); reg.ca = { state: 'stated', label: 'Contract', value: 'not-an-address' };
  fs.mkdirSync(TMP, { recursive: true });
  const f = path.join(TMP, 'badca.json'); fs.writeFileSync(f, JSON.stringify(reg));
  let t = false; try { build({ registerPath: f, outDir: path.join(TMP, 'badca') }); } catch { t = true; }
  ok(t, 'accepted');
});

group = 'address scanner';
await gate('0x hex is matched against the registry, never blanket-rejected', () => {
  const evm = '0x' + 'ab12'.repeat(10);
  const reg = { ca: { state: 'stated', value: evm } };
  eq(unknownAddresses(`see ${evm}`, reg).length, 0, 'stated 0x rejected');
  eq(unknownAddresses(`see ${evm}`, { ca: { state: 'absent' } }).length, 1, 'unknown 0x allowed');
  eq(unknownAddresses('mask 0x9e3779b1 and 0xff', reg).length, 0, 'short 0x flagged');
});
await gate('built pages contain no address except stated registry values', () => {
  const jsText = jsFiles.map(([, s]) => s).join('\n');
  eq(unknownAddresses(html + jsText, cur).length, 0, 'unknown address in page');
  const v = variant('ca', 'stated', { value: TEST_CA });
  eq(unknownAddresses(v.html, v.reg).length, 0, 'CA flagged by scanner');
  const poisoned = v.html.replace('</footer>', 'Hd8cV3kLq9ZpR2mXw5Yt7NfB4jGsA6uEeD1oCzP8hQxK</footer>');
  eq(unknownAddresses(poisoned, v.reg).length, 1, 'scanner missed an injected address');
});

group = 'market';
await gate('market is independent of the contract state (markup, projection, code identical)', () => {
  const a = variant('ca', 'absent'), s = variant('ca', 'stated', { value: TEST_CA });
  const sections = (h) => slice(h, '<div class="ticker"', '<section class="section" id="flow"');
  eq(sections(a.html), sections(s.html), 'market markup differs');
  const mk = (h) => JSON.parse(h.match(/<script type="application\/json" id="register">([\s\S]*?)<\/script>/)[1]).market;
  eq(JSON.stringify(mk(a.html)), JSON.stringify(mk(s.html)), 'market projection differs');
  for (const f of fs.readdirSync(path.join(a.dir, 'js'))) eq(read(path.join(a.dir, 'js', f)), read(path.join(s.dir, 'js', f)), `js/${f} differs`);
  ok(!/reg\.ca|\.ca\b/.test(read(P('src/js/market.js'))) && !/reg\.ca\b/.test(read(P('src/js/main.js'))), 'js reads the ca record');
});
await gate('market follows its own record: absent -> no source urls in page', () => {
  const off = variant('market', 'absent'), on = variant('market', 'stated', { boosts: cur.market.boosts, pairs: cur.market.pairs });
  ok(!off.html.includes('dexscreener'), 'inert market leaks url');
  ok(on.html.includes('https://api.dexscreener.com/token-boosts/top/v1') && on.html.includes('https://api.dexscreener.com/tokens/v1/solana/'), 'stated market lacks urls');
});
const M = await import(pathToFileURL(P('src/js/market.js')).href);
const F = await import(pathToFileURL(P('src/js/format.js')).href);
const mkPair = (addr, vol, liq, extra = {}) => ({ chainId: 'solana', baseToken: { address: addr, symbol: addr.toUpperCase(), name: addr }, priceUsd: '1.5', priceNative: '0.01', quoteToken: { symbol: 'SOL' }, priceChange: { h24: 3 }, volume: { h24: vol }, liquidity: { usd: liq }, info: { imageUrl: `https://img/${addr}` }, ...extra });
await gate('feed keeps solana only, deepest pair per token, top 10 by 24h volume', async () => {
  const boosts = [...Array.from({ length: 14 }, (_, i) => ({ chainId: 'solana', tokenAddress: `t${i}` })), { chainId: 'ethereum', tokenAddress: 'eth1' }, { chainId: 'solana', tokenAddress: 't0' }];
  const pairs = [...Array.from({ length: 14 }, (_, i) => mkPair(`t${i}`, (i + 1) * 100, 10)), mkPair('t0', 99999, 5000), mkPair('t0', 1, 1), mkPair('eth1', 1e9, 1e9, { chainId: 'ethereum' })];
  const urls = [];
  const fakeFetch = async (u) => { urls.push(u); return { ok: true, json: async () => (u.includes('token-boosts') ? boosts : pairs) }; };
  const rows = await M.loadRows({ boosts: cur.market.boosts, pairs: cur.market.pairs }, fakeFetch);
  eq(rows.length, 10, 'row count');
  ok(rows.every((r, i) => i === 0 || rows[i - 1].volume >= r.volume), 'not sorted by volume');
  ok(!rows.some((r) => r.address === 'eth1'), 'non-solana leaked');
  eq(rows[0].address, 't0', 'deepest pair not chosen'); eq(rows[0].volume, 99999, 'pair volume');
  ok(urls.some((u) => u.startsWith(cur.market.pairs + 't0,')), 'pairs endpoint shape');
  eq(M.chunk(Array.from({ length: 61 }, (_, i) => i), M.CHUNK).length, 3, 'chunking to 30');
});
await gate('backoff is exponential and capped; poll is 60s', () => {
  eq(M.POLL_MS, 60000, 'poll');
  const d = [1, 2, 3, 4, 5, 6, 7, 8, 12].map((n) => M.backoffDelay(n, () => 0.5));
  eq(d[0], 2000, 'first retry'); eq(d[1], 4000, 'second'); eq(d[2], 8000, 'third');
  ok(d.every((x, i) => i === 0 || x >= d[i - 1]), 'not monotonic'); eq(d[d.length - 1], 60000, 'cap');
});
await gate('loop: retries with backoff, resumes the 60s cadence, pauses hidden, fetches at once on visible, keeps last good data', async () => {
  const timers = []; let n = 0;
  const listeners = {};
  const doc = { hidden: false, addEventListener: (e, f) => { listeners[e] = f; }, removeEventListener() {} };
  let fail = false, fetches = 0;
  const boosts = [{ chainId: 'solana', tokenAddress: 'a' }];
  const fakeFetch = async (u) => { fetches++; if (fail) throw new Error('down'); return { ok: true, json: async () => (u.includes('boosts') ? boosts : [mkPair('a', 5, 5)]) }; };
  const log = { data: 0, err: 0, last: null };
  const feed = M.createFeed({ boosts: 'https://x/boosts', pairs: 'https://x/pairs/' }, { onData: (r) => { log.data++; log.last = r; }, onError: () => { log.err++; } },
    { doc, fetch: fakeFetch, setTimeout: (f, ms) => { timers.push({ f, ms, id: ++n }); return n; }, clearTimeout: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); } });
  const tick = () => new Promise((r) => setImmediate(r));
  feed.start(); await tick(); await tick();
  eq(log.data, 1, 'first load'); eq(timers.at(-1).ms, 60000, 'cadence after success');
  fail = true; await timers.at(-1).f(); await tick();
  eq(log.err, 1, 'error reported'); ok(timers.at(-1).ms >= 1500 && timers.at(-1).ms <= 2700, `first backoff ${timers.at(-1).ms}`);
  ok(log.last && log.last.length === 1, 'last good data dropped');
  await timers.at(-1).f(); await tick();
  ok(timers.at(-1).ms >= 3400 && timers.at(-1).ms <= 4700, `second backoff ${timers.at(-1).ms}`);
  doc.hidden = true; listeners.visibilitychange(); eq(timers.length, 0, 'timer survived hidden');
  const before = fetches; await tick(); eq(fetches, before, 'fetched while hidden');
  fail = false; doc.hidden = false; listeners.visibilitychange(); await tick(); await tick();
  ok(fetches > before, 'no immediate fetch on visible'); eq(log.data, 2, 'recovered'); eq(timers.at(-1).ms, 60000, 'cadence restored');
  feed.stop();
});
await gate('UI keeps last good rows on refresh failure and shows dashes + error when nothing loaded', () => {
  const m = read(P('src/js/main.js'));
  ok(/const have = state\.rows\.length > 0/.test(m) && /if \(!have\)/.test(m), 'guard');
  ok(/Feed unreachable/.test(m) && /textContent = '—'/.test(m), 'error + dash');
});
await gate('price/volume formatting: subscript zeros, compact units', () => {
  eq(F.fmtPrice(0.0000281), '$0.0₄281', 'subscript'); eq(F.fmtPrice(1.5712), '$1.57', 'normal');
  eq(F.fmtCompact(56_100_000), '$56.10M', 'millions'); eq(F.fmtPct(-7.614), '−7.61%', 'negative pct');
});
await gate('letter tile fallback, skeleton, ticker, per-row copy, 10 rows', () => {
  const m = read(P('src/js/main.js'));
  ok(/img\.onerror = \(\) => img\.remove\(\)/.test(m) && /charAt\(0\)\.toUpperCase\(\)/.test(m), 'tile fallback');
  ok(/class="skel skeleton/.test(m) && /dataset\.ready/.test(m) && /LIMIT/.test(m), 'skeleton');
  ok(/#marquee/.test(m) && /items \+ items/.test(m), 'marquee');
  ok(/data-copy|dataset\.copy/.test(m) && /Copy mint address/.test(m), 'row copy');
  ok(/imageUrl/.test(read(P('src/js/market.js'))), 'imageUrl');
});

group = 'motion';
await gate('reduced-motion: css kills every animation/transition, js skips spring, parallax, count-up', () => {
  ok(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*animation: none !important[\s\S]*transition: none !important/.test(css), 'css');
  const mo = read(P('src/js/motion.js'));
  ok((mo.match(/reduced\(\)/g) || []).length >= 4, 'js guards');
  ok(/matchMedia\('\(prefers-reduced-motion: reduce\)'\)/.test(mo) && /classList\.add\("rm"\)/.test(html), 'detect');
});
await gate('visual system present: spring solver, parallax, mesh, spotlight, progress bar, live dot, count-up flash', () => {
  const mo = read(P('src/js/motion.js'));
  ok(/-k \* \(this\.x - to\) - c \* this\.v/.test(mo), 'damped spring');
  ok(/data-depth/.test(html) && /pointermove/.test(mo) && /scrollY/.test(mo), 'parallax');
  ok(/\.mesh/.test(css) && /@keyframes drift/.test(css), 'mesh');
  ok(/\[data-spot\]::before/.test(css) && /radial-gradient\(260px circle/.test(css), 'spotlight');
  ok(/\.progress/.test(css) && /initProgress/.test(allJs), 'progress');
  ok(/\.live-dot/.test(css) && /@keyframes ping/.test(css) && /class="live-dot"/.test(html), 'pulse');
  ok(/flash-up/.test(css) && /flash-down/.test(css) && /export function countTo/.test(mo), 'count-up');
  ok(/@keyframes shimmer/.test(css), 'skeleton shimmer');
});
await gate('timings measured from the reference are matched (ease, 70s marquee, 1.6s ping, 5.2s ticket loop)', () => {
  ok(css.includes('cubic-bezier(.2, .8, .2, 1)') && /animation: slide 70s linear infinite/.test(css) && /ping 1\.6s ease-out/.test(css) && /5\.2s/.test(css) && /ticket-in \.5s/.test(css), 'timings');
});

group = 'dates';
await gate('no dates, clocks, "as of" or "checked" anywhere in dist (text, attrs, aria, tooltips, js, css)', () => {
  const MON = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';
  const bad = [/\b\d{4}-\d{2}-\d{2}\b/, /\b\d{1,2}[\/.]\d{1,2}[\/.]\d{2,4}\b/, new RegExp(`\\b${MON}\\s+\\d{1,2}\\b`, 'i'), new RegExp(`\\b\\d{1,2}\\s+${MON}\\b`, 'i'), /\b20[23]\d\b/, /\b\d{1,2}:\d{2}(?::\d{2})?\b/, /\bas of\b/i, /\bchecked\b/i, /\bupdated\b/i, /\blast sync/i, /\btimestamp\b/i];
  for (const f of listFiles(dist).filter(isText)) {
    const s = read(f).replace(/#[0-9a-fA-F]{6,8}/g, '').replace(/\sd="[^"]*"/g, '').replace(/https?:\/\/www\.w3\.org\/\d+\/\w+/g, '');
    for (const re of bad) { const m = s.match(re); ok(!m, `${path.relative(dist, f)}: "${m && m[0]}"`); }
  }
  ok(!/new Date|toLocale(?:Time|Date)String|Intl\.DateTimeFormat|Date\.now/.test(allJs), 'js builds a date');
  for (const st of ['absent', 'stated']) {
    const v = variant('ca', st, st === 'stated' ? { value: TEST_CA } : {});
    ok(!/\b20[23]\d\b|recorded/.test(v.html), `${st} variant has a date`);
  }
});

group = 'copy';
await gate('zero shared 2-grams with the reference copy (per text node, attrs included)', () => {
  const ref = new Set(read(P('scripts/ref-copy.txt')).split('\n').flatMap(bigrams));
  const lines = [...textLines(html), ...[...allJs.matchAll(/'([^'\n]{8,})'/g)].map((m) => m[1]).filter((s) => /\s/.test(s) && !/[<>{}=;]/.test(s))];
  const hits = [];
  for (const l of lines) for (const g of bigrams(l)) if (ref.has(g)) hits.push(`${g}  <- ${l.slice(0, 60)}`);
  eq(hits.length, 0, `shared 2-grams: ${hits.slice(0, 6).join(' | ')}`);
});
await gate('content words shared with the reference are limited to data labels and the brand/chain names', () => {
  const STOP = new Set('a an and are as at be by can for from has in into is it its of on or so that the their them then there they this to we with you your which who what when while whom no each all'.split(' '));
  const ALLOW = new Set(['size', 'solana', 'sol', 'price', 'volume', 'liquidity', '24h', 'change', 'live', 'coin', 'coins']);
  const refW = new Set(read(P('scripts/ref-copy.txt')).split('\n').flatMap(words).filter((w) => !STOP.has(w)));
  const shared = new Set();
  for (const l of textLines(html)) for (const w of words(l)) if (refW.has(w) && !STOP.has(w) && !ALLOW.has(w) && !/^\d/.test(w)) shared.add(w);
  eq([...shared].length, 0, `shared words: ${[...shared].join(', ')}`);
});

group = 'mobile + measure';
await gate('no ch units; 44px tap tokens on every control class', () => {
  for (const [n, s] of [['css', css], ['html', html], ['js', allJs]]) ok(!/(?:^|[^\w-])\d*\.?\d+ch\b/.test(s), `ch unit in ${n}`);
  ok(/--tap: 44px/.test(css), 'tap token');
  for (const sel of ['\\.nav-link', '\\.btn', '\\.chip', '\\.tab', '\\.copy', '\\.chips a', '\\.ca-value']) ok(new RegExp(`${sel}[^{]*\\{[^}]*min-(?:height|width): var\\(--tap\\)`).test(css), `${sel} below 44px`);
  ok(/<meta name="viewport" content="width=device-width, initial-scale=1/.test(html), 'viewport');
});

group = 'repo hygiene';
await gate('no agent config files or folders, no attribution anywhere in the repo', () => {
  const skip = (f) => /node_modules|[\\/]\.gates-tmp|[\\/]brand[\\/]|[\\/]reference[\\/]|[\\/]dist[\\/]fonts|public[\\/]fonts|scripts[\\/]gates\.mjs|\.png$|\.woff2$|\.jpe?g$/.test(f);
  const names = listFiles(root).filter((f) => !/node_modules|\.gates-tmp/.test(f));
  ok(!names.some((f) => /[\\/]\.claude[\\/]|CLAUDE\.md$/i.test(f)), 'agent config present');
  const words2 = new RegExp([['cla', 'ude'], ['anthro', 'pic'], ['chat', 'gpt'], ['open', 'ai'], ['co-authored', '-by'], ['generated (?:by|with)', ''], ['\\bA', 'I[- ]?(?:generated|assisted|powered)']].map((p) => p.join('')).join('|'), 'i');
  for (const f of names.filter((x) => !skip(x) && isText(x))) ok(!words2.test(read(f)), `attribution in ${path.relative(root, f)}`);
});
await gate('README, whitepaper, LICENSE exist at the root and not in dist', () => {
  for (const f of ['README.md', 'docs/whitepaper.md', 'LICENSE']) ok(fs.existsSync(P(f)), `${f} missing`);
  ok(/MIT License/.test(read(P('LICENSE'))) && /Copyright \(c\) 2026 Size/.test(read(P('LICENSE'))), 'license text');
  ok(!fs.existsSync(P('dist/README.md')) && !fs.existsSync(P('dist/LICENSE')) && !fs.existsSync(P('dist/docs')), 'repo docs in dist');
});

// ---------- report ----------
fs.rmSync(TMP, { recursive: true, force: true });
let g = '';
for (const r of results) {
  if (r.group !== g) { g = r.group; console.log(`\n[${g}]`); }
  console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `\n        -> ${r.why}`}`);
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\ngates: ${results.length - failed}/${results.length} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);
