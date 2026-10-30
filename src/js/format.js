const SUB = ['\u2080', '\u2081', '\u2082', '\u2083', '\u2084', '\u2085', '\u2086', '\u2087', '\u2088', '\u2089'];
const subscript = (n) => String(n).split('').map((d) => SUB[+d]).join('');

export function fmtCompact(n) {
  if (!Number.isFinite(n)) return '\u2014';
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

export function fmtPrice(n) {
  if (!Number.isFinite(n) || n <= 0) return '\u2014';
  if (n >= 1000) return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(4)}`;
  // tiny prices: collapse the run of leading zeros into a subscript count
  const s = n.toFixed(20);
  const zeros = s.slice(2).match(/^0*/)[0].length;
  const digits = s.slice(2 + zeros, 2 + zeros + 4).replace(/0+$/, '') || '0';
  return `$0.0${subscript(zeros)}${digits}`;
}

export function fmtPct(n, digits = 2) {
  if (!Number.isFinite(n)) return '\u2014';
  return `${n > 0 ? '+' : n < 0 ? '\u2212' : ''}${Math.abs(n).toFixed(digits)}%`;
}

export function fmtNum(n) {
  if (!Number.isFinite(n)) return '\u2014';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString('en-US', { maximumFractionDigits: n < 10 ? 3 : 1 });
}
