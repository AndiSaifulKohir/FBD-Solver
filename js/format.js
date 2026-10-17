/**
 * Display helpers. Rounding lives here, never in the solver.
 */

export function fmt(value, digits = 3) {
  if (!Number.isFinite(value)) return '–';
  let v = Math.abs(value) < 0.5 * 10 ** -digits ? 0 : value;
  let s = v.toFixed(digits);
  if (s.includes('.')) s = s.replace(/\.?0+$/, '');
  return s.replace('-', '−');
}

/** Render one equilibrium row as text, e.g. "Ay + By − 12". The caller adds " = 0". */
export function equationText(row, labels) {
  const join = (out, negative, term) =>
    out ? `${out} ${negative ? '−' : '+'} ${term}` : `${negative ? '−' : ''}${term}`;

  let out = '';
  row.coeffs.forEach((c, i) => {
    if (Math.abs(c) < 1e-12) return;
    const mag = Math.abs(c);
    const term = Math.abs(mag - 1) < 1e-12 ? labels[i] : `${fmt(mag)}·${labels[i]}`;
    out = join(out, c < 0, term);
  });

  if (Math.abs(row.known) >= 5e-4) {
    out = join(out, row.known < 0, fmt(Math.abs(row.known)));
  }
  return out || '0';
}
