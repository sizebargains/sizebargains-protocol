export const reduced = () => {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

/* shared rAF loop with a fixed-step damped spring solver */
const live = new Set();
let raf = 0, last = 0;
const STEP = 1 / 120;

function frame(t) {
  const dt = Math.min(0.05, (t - last) / 1000);
  last = t;
  let acc = dt;
  while (acc > 0) {
    const h = Math.min(STEP, acc);
    for (const s of live) s.tick(h);
    acc -= h;
  }
  for (const s of live) s.paint();
  for (const s of [...live]) if (s.done) live.delete(s);
  raf = live.size ? requestAnimationFrame(frame) : 0;
}

function run(s) {
  live.add(s);
  if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
}

/* x'' = -k (x - to) - c x'  ; zeta = c / (2 sqrt(k m)) ~ 0.84 here, a touch of overshoot */
export function spring({ from = 0, to = 1, k = 170, c = 22, mass = 1, delay = 0, onUpdate, onDone }) {
  if (reduced()) { onUpdate(to); onDone && onDone(); return; }
  const s = {
    x: from, v: 0, done: false, wait: delay / 1000,
    tick(h) {
      if (this.wait > 0) { this.wait -= h; return; }
      const a = (-k * (this.x - to) - c * this.v) / mass;
      this.v += a * h;
      this.x += this.v * h;
      if (Math.abs(this.x - to) < 0.0005 && Math.abs(this.v) < 0.001) { this.x = to; this.done = true; }
    },
    paint() { onUpdate(this.x); if (this.done && onDone) onDone(); },
  };
  run(s);
}

/* scroll-reveal with stagger inside each intersection batch */
export function initReveal() {
  const els = [...document.querySelectorAll('[data-reveal]')];
  const show = (el, delay) => {
    spring({
      delay,
      onUpdate(p) {
        el.style.opacity = String(Math.max(0, Math.min(1, p * 1.25)));
        el.style.transform = `translate3d(0, ${(1 - p) * 26}px, 0) scale(${0.985 + 0.015 * p})`;
      },
      onDone() { el.style.opacity = ''; el.style.transform = ''; el.removeAttribute('data-reveal'); },
    });
  };
  if (reduced() || !('IntersectionObserver' in window)) {
    els.forEach((el) => el.removeAttribute('data-reveal'));
    document.documentElement.classList.add('rm');
    return;
  }
  const io = new IntersectionObserver((entries) => {
    let i = 0;
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      show(e.target, i++ * 70);
    }
  }, { threshold: 0.08, rootMargin: '0px 0px -6% 0px' });
  els.forEach((el) => io.observe(el));
}

/* hero depth layers: pointer + scroll, smoothed by a critically damped follower */
export function initParallax() {
  const hero = document.getElementById('hero');
  if (!hero || reduced()) return;
  const layers = [...hero.querySelectorAll('.layer[data-depth]')];
  const target = { x: 0, y: 0 }, cur = { x: 0, y: 0 }, vel = { x: 0, y: 0 };
  let ticking = false, vis = true;
  new IntersectionObserver(([e]) => { vis = e.isIntersecting; if (vis) kick(); }).observe(hero);
  const kick = () => { if (!ticking) { ticking = true; requestAnimationFrame(step); } };
  hero.addEventListener('pointermove', (e) => {
    const r = hero.getBoundingClientRect();
    target.x = ((e.clientX - r.left) / r.width - 0.5) * 2;
    target.y = ((e.clientY - r.top) / r.height - 0.5) * 2;
    kick();
  });
  hero.addEventListener('pointerleave', () => { target.x = 0; target.y = 0; kick(); });
  addEventListener('scroll', kick, { passive: true });
  function step() {
    const k = 120, c = 2 * Math.sqrt(k), h = 1 / 60;
    for (const a of ['x', 'y']) {
      vel[a] += (-k * (cur[a] - target[a]) - c * vel[a]) * h;
      cur[a] += vel[a] * h;
    }
    const sy = Math.min(scrollY, 900);
    for (const l of layers) {
      const d = parseFloat(l.dataset.depth);
      l.style.translate = `${(cur.x * d * 22).toFixed(2)}px ${(cur.y * d * 16 - sy * d * 0.12).toFixed(2)}px`;
    }
    const moving = Math.abs(cur.x - target.x) + Math.abs(cur.y - target.y) + Math.abs(vel.x) + Math.abs(vel.y) > 0.002;
    ticking = false;
    if (moving && vis) kick();
  }
  kick();
}

export function initProgress() {
  const bar = document.querySelector('.progress i');
  if (!bar) return;
  const upd = () => {
    const max = document.documentElement.scrollHeight - innerHeight;
    bar.style.setProperty('--p', max > 0 ? Math.min(1, scrollY / max).toFixed(4) : '0');
  };
  addEventListener('scroll', upd, { passive: true });
  addEventListener('resize', upd);
  upd();
}

/* pointer-tracked spotlight for cards, rows, tiles */
export function initSpotlight() {
  document.addEventListener('pointermove', (e) => {
    const el = e.target.closest && e.target.closest('[data-spot], .row:not(.head)');
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${(e.clientX - r.left).toFixed(0)}px`);
    el.style.setProperty('--my', `${(e.clientY - r.top).toFixed(0)}px`);
  }, { passive: true });
}

/* number count-up with a flash in the direction of change */
const tweens = new WeakMap();
export function countTo(el, to, fmt, { from, flash = true, ms = 700 } = {}) {
  const prev = tweens.get(el);
  if (prev) prev.cancel = true;
  const start = Number.isFinite(from) ? from : (el._n ?? NaN);
  el._n = to;
  if (!Number.isFinite(to)) { el.textContent = fmt(to); return; }
  if (reduced() || !Number.isFinite(start) || start === to) { el.textContent = fmt(to); return; }
  if (flash) {
    el.classList.remove('flash-up', 'flash-down');
    void el.offsetWidth;
    el.classList.add(to > start ? 'flash-up' : 'flash-down');
  }
  const job = { cancel: false };
  tweens.set(el, job);
  const t0 = performance.now();
  const loop = (t) => {
    if (job.cancel) return;
    const p = Math.min(1, (t - t0) / ms);
    const e = 1 - Math.pow(1 - p, 4);
    el.textContent = fmt(start + (to - start) * e);
    if (p < 1) requestAnimationFrame(loop); else el.textContent = fmt(to);
  };
  requestAnimationFrame(loop);
}
