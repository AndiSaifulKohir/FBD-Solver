/**
 * Small shared helpers. Pure functions, no DOM.
 */

export function clean(v) {
  return Math.abs(v) < 1e-12 ? 0 : v;
}

/** Unit vector for an angle in degrees (counterclockwise from +x), exact at multiples of 90. */
export function directionOf(angleDeg) {
  const r = (angleDeg * Math.PI) / 180;
  return [clean(Math.cos(r)), clean(Math.sin(r))];
}

export function supportLabel(i) {
  return i < 26 ? String.fromCharCode(65 + i) : `S${i + 1}`;
}

/** Moment of force (fx, fy) acting at (x, y), taken about (px, py). Counterclockwise is positive. */
export function momentAbout(px, py, x, y, fx, fy) {
  return (x - px) * fy - (y - py) * fx;
}

/**
 * Gauss-Jordan elimination with partial pivoting on an augmented matrix.
 * Only the first nCols columns are used to choose pivots. Mutates M.
 */
export function rref(M, nCols, tol) {
  const rows = M.length;
  const pivots = [];
  let r = 0;
  for (let c = 0; c < nCols && r < rows; c++) {
    let p = r;
    for (let i = r + 1; i < rows; i++) {
      if (Math.abs(M[i][c]) > Math.abs(M[p][c])) p = i;
    }
    if (Math.abs(M[p][c]) <= tol) continue;
    [M[r], M[p]] = [M[p], M[r]];
    const pivot = M[r][c];
    for (let j = 0; j < M[r].length; j++) M[r][j] /= pivot;
    for (let i = 0; i < rows; i++) {
      if (i === r) continue;
      const factor = M[i][c];
      if (factor === 0) continue;
      for (let j = 0; j < M[i].length; j++) M[i][j] -= factor * M[r][j];
    }
    pivots.push(c);
    r++;
  }
  return { pivots, rank: r };
}
