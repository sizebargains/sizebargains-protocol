import { createFeed, sortRows, LIMIT } from './market.js';
import { fmtCompact, fmtPrice, fmtPct, fmtNum } from './format.js';
import { initReveal, initParallax, initProgress, initSpotlight, countTo, reduced } from './motion.js';

const $ = (s, r = document) => r.querySelector(s);
const reg = JSON.parse($('#register').textContent);

const COPY_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/></svg>';
const OK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------- copy (contract slot + row mint buttons) ---------- */
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  const ta = document.createElement('textarea');
  ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0;top:0';
  document.body.appendChild(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-copy]');
  if (!btn || btn.disabled) return;
  const ok = await copyText(btn.dataset.copy);
  if (btn.classList.contains('ca-value')) {
    const t = $('.ca-hint-text', btn), live = $('#ca-live');
    btn.classList.toggle('is-copied', ok);
    if (t) t.textContent = ok ? 'Copied' : 'Press Ctrl+C';
    if (live) live.textContent = ok ? 'Contract address copied' : 'Copy failed';
    setTimeout(() => { btn.classList.remove('is-copied'); if (t) t.textContent = 'Copy'; if (live) live.textContent = ''; }, 1800);
  } else {
    btn.classList.toggle('is-done', ok);
    btn.innerHTML = (ok ? OK_SVG : COPY_SVG) + '<span class="copy-lbl">' + (ok ? 'Copied' : 'Failed') + '</span>';
    setTimeout(() => { btn.classList.remove('is-done'); btn.innerHTML = COPY_SVG + '<span class="copy-lbl">Copy</span>'; }, 1500);
  }
});

/* ---------- board ---------- */
const rowsEl = $('#rows'), noteEl = $('#board-note'), pill = $('#feed-pill'), pillText = $('#feed-text');
const state = { rows: [], sort: 'vol', picked: null, shown: [] };

function rowTemplate(i) {
  const r = document.createElement('div');
  r.className = 'row'; r.dataset.ready = '0';
  r.innerHTML = `
    <span class="c-rank"><i class="skel skeleton sk" style="width:16px"></i><span class="real">${i + 1}</span></span>
    <div class="c-coin"><span class="coin"><i class="skel skeleton" style="position:absolute;inset:0;border-radius:50%"></i><span class="real tile"></span></span><div><i class="skel skeleton sk" style="width:84px"></i><b class="real sym"></b><span class="real nm"></span></div></div>
    <span class="c-price"><i class="skel skeleton sk" style="width:64px;margin-left:auto"></i><span class="real v-price">—</span></span>
    <span class="c-chg"><i class="skel skeleton sk" style="width:48px;margin-left:auto"></i><span class="real v-chg">—</span></span>
    <span class="c-vol"><i class="skel skeleton sk" style="width:56px;margin-left:auto"></i><span class="real v-vol">—</span></span>
    <span class="c-liq"><i class="skel skeleton sk" style="width:56px;margin-left:auto"></i><span class="real v-liq">—</span></span>
    <span class="c-act"><i class="skel skeleton" style="width:44px;height:44px;border-radius:10px"></i><button class="real copy" type="button" aria-label="Copy mint address">${COPY_SVG}<span class="copy-lbl">Copy</span></button></span>
    <div class="m-line"><span>Vol <b class="real v-vol2">—</b></span><span>Liq <b class="real v-liq2">—</b></span></div>`;
  return r;
}
for (let i = 0; i < LIMIT; i++) rowsEl.appendChild(rowTemplate(i));

function setCoin(el, row) {
  const tile = $('.tile', el) || $('span', el) || el;
  const letter = (row.symbol || '?').replace(/^\$/, '').charAt(0).toUpperCase() || '?';
  tile.textContent = letter;
  el.querySelectorAll('img').forEach((n) => n.remove());
  if (!row.imageUrl) return;
  const img = new Image();
  img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
  img.style.opacity = '0'; img.style.transition = 'opacity .4s cubic-bezier(.2,.8,.2,1)';
  img.onload = () => { img.style.opacity = '1'; };
  img.onerror = () => img.remove();
  img.src = row.imageUrl;
  el.appendChild(img);
}

function paintChange(el, v, animate) {
  countTo(el, v, (n) => fmtPct(n), { flash: animate });
  el.classList.toggle('up', v > 0);
  el.classList.toggle('down', v < 0);
}

function applyRows(rows, { animate = true } = {}) {
  const ordered = sortRows(rows, state.sort).slice(0, LIMIT);
  [...rowsEl.children].forEach((el, i) => {
    const row = ordered[i];
    if (!row) { el.dataset.ready = '0'; return; }
    const same = el.dataset.addr === row.address;
    const first = el.dataset.ready === '0';
    el.dataset.addr = row.address;
    $('.sym', el).textContent = row.symbol;
    $('.nm', el).textContent = row.name;
    if (!same) { setCoin($('.coin', el), row); $('.copy', el).dataset.copy = row.address; }
    const a = animate && same;
    const from = same ? undefined : NaN;
    countTo($('.v-price', el), row.price, fmtPrice, { from, flash: a });
    paintChange($('.v-chg', el), row.change, a);
    countTo($('.v-vol', el), row.volume, fmtCompact, { from, flash: a });
    countTo($('.v-liq', el), row.liquidity, fmtCompact, { from, flash: a });
    $('.v-vol2', el).textContent = fmtCompact(row.volume);
    $('.v-liq2', el).textContent = fmtCompact(row.liquidity);
    if (first) { el.style.setProperty('--d', `${reduced() ? 0 : i * 55}ms`); el.dataset.ready = '1'; }
  });
  state.shown = ordered;
}

/* ---------- ticker ---------- */
function paintTicker(rows) {
  const items = sortRows(rows, 'vol').map((r) => {
    const cls = r.change > 0 ? 'up' : r.change < 0 ? 'down' : '';
    const arrow = r.change > 0 ? '▲' : r.change < 0 ? '▼' : '';
    return `<span class="tick"><b>${esc(r.symbol)}</b>${fmtPrice(r.price)}<span class="${cls}">${arrow} ${fmtPct(r.change)}</span></span>`;
  }).join('');
  $('#marquee').innerHTML = items + items;
}

/* ---------- hero stats ---------- */
function paintStats(rows) {
  countTo($('#st-count'), rows.length, (n) => String(Math.round(n)), { flash: false });
  countTo($('#st-vol'), rows.reduce((s, r) => s + r.volume, 0), fmtCompact);
}

/* ---------- worked example ticket ---------- */
const tUsd = $('#t-usd');
function pickRow() { return state.rows.find((r) => r.address === state.picked) || sortRows(state.rows, 'vol')[0]; }

function paintTicket() {
  const r = pickRow();
  if (!r) return;
  const usd = parseFloat(String(tUsd.value).replace(/[^0-9.]/g, ''));
  const ok = Number.isFinite(usd) && usd > 0 && r.price > 0;
  $('#t-title').textContent = `Stack of ${r.symbol}`;
  setCoin($('#t-coin'), r);
  $('#t-sym').textContent = r.symbol;
  const tokens = ok ? usd / r.price : NaN;
  countTo($('#t-get'), tokens, fmtNum, { flash: false });
  const sol = r.quote === 'SOL' && Number.isFinite(r.priceNative) ? tokens * r.priceNative : NaN;
  countTo($('#t-send'), sol, fmtNum, { flash: false });
  const half = r.liquidity / 2;
  const drag = ok && half > 0 ? (usd / (half + usd)) * 100 : NaN;
  countTo($('#t-drag'), drag, (n) => (Number.isFinite(n) ? `−${n.toFixed(2)}%` : '—'), { flash: false });
  $('#t-drag-bar').style.transform = `scaleX(${Number.isFinite(drag) ? Math.min(1, drag / 100).toFixed(3) : 0})`;
}

function paintChips() {
  const box = $('#t-chips');
  const top = sortRows(state.rows, 'vol').slice(0, 5);
  const sel = pickRow();
  box.innerHTML = top.map((r) => `<button class="chip" type="button" data-addr="${esc(r.address)}" aria-pressed="${!!sel && sel.address === r.address}">${esc(r.symbol)}</button>`).join('');
}
$('#t-chips').addEventListener('click', (e) => {
  const b = e.target.closest('.chip'); if (!b) return;
  state.picked = b.dataset.addr; paintChips(); paintTicket();
});
tUsd.addEventListener('input', paintTicket);

/* ---------- feed lifecycle ---------- */
function setFeed(kind, text) { pill.dataset.feed = kind; pillText.textContent = text; }

function onData(rows) {
  const first = state.rows.length === 0;
  state.rows = rows;
  applyRows(rows, { animate: !first });
  paintTicker(rows); paintStats(rows); paintChips(); paintTicket();
  setFeed('live', 'Live');
  noteEl.textContent = 'Figures come from public market feeds and refresh on their own.';
  noteEl.dataset.kind = 'info';
}

function onError(err, n) {
  setFeed('down', 'Retrying');
  const have = state.rows.length > 0;
  noteEl.dataset.kind = 'error';
  noteEl.textContent = have
    ? 'Feed unreachable. Showing the last good figures while retrying.'
    : 'Feed unreachable. Dashes mean no data yet; retrying with a growing pause.';
  if (!have) {
    [...rowsEl.children].forEach((el) => { el.dataset.ready = '1'; });
    $('#st-count').textContent = '—'; $('#st-vol').textContent = '—';
    $('#marquee').innerHTML = '<span class="tick">Quotes unavailable</span>';
  }
  console.warn('[size] feed error', n, err && err.message);
}

$('.tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-sort]'); if (!b) return;
  state.sort = b.dataset.sort;
  document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t === b)));
  if (state.rows.length) applyRows(state.rows, { animate: false });
});

/* ---------- boot ---------- */
initReveal(); initProgress(); initSpotlight(); initParallax();

const links = [...document.querySelectorAll('.nav-link[data-nav]')];
const spy = new IntersectionObserver((es) => {
  for (const e of es) if (e.isIntersecting) links.forEach((l) => l.classList.toggle('is-on', l.dataset.nav === e.target.id));
}, { rootMargin: '-35% 0px -55% 0px' });
['top', 'board', 'flow', 'facts', 'risks'].forEach((id) => { const n = document.getElementById(id); if (n) spy.observe(n); });

if (reg.market && reg.market.state === 'stated') {
  createFeed({ boosts: reg.market.boosts, pairs: reg.market.pairs }, { onData, onError }).start();
} else {
  setFeed('idle', 'Pending');
  noteEl.textContent = 'pending';
  [...rowsEl.children].forEach((el) => { el.dataset.ready = '1'; });
}
