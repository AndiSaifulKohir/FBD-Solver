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

/**
 * A load that varies linearly from intensity wa to wb over a length, split into
 * a uniform part and a triangular part. Together they give the exact net force
 * and moment, even when the intensity changes sign along the span.
 * `at` is the distance of each part's resultant from the start.
 */
export function loadParts(wa, wb, length) {
  return [
    { force: wa * length, at: length / 2 },
    { force: ((wb - wa) * length) / 2, at: (2 * length) / 3 },
  ];
}

/**
 * The same for a load portion stored on a segment: { lo, hi, wa, wb, dx, dy },
 * where lo..hi is the loaded stretch, wa and wb the intensities there and
 * (dx, dy) the load direction. With `upTo`, only the part before that position.
 * Returns point forces { fx, fy, s } with s measured along the segment.
 */
export function portionParts(u, upTo = Infinity) {
  const hi = Math.min(u.hi, upTo);
  const ell = hi - u.lo;
  if (!(ell > 0)) return [];
  const slope = (u.wb - u.wa) / (u.hi - u.lo);
  return loadParts(u.wa, u.wa + slope * ell, ell).map((p) => ({
    fx: p.force * u.dx,
    fy: p.force * u.dy,
    s: u.lo + p.at,
  }));
}
