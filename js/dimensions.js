/**
 * Automatic dimensioning: every point you have defined (member ends, supports,
 * loads, hinges) contributes a position. Dimension chains run between the
 * distinct positions. Pure logic, no DOM.
 */

/** Every defined point, with the kind of item it belongs to. */
export function definedPoints(problem) {
  const pts = [];
  for (const m of problem.members) pts.push({ x: m.x1, y: m.y1, kind: 'member' }, { x: m.x2, y: m.y2, kind: 'member' });
  for (const s of problem.supports) pts.push({ x: s.x, y: s.y, kind: 'support' });
  for (const f of problem.forces) pts.push({ x: f.x, y: f.y, kind: 'force' });
  for (const c of problem.moments) pts.push({ x: c.x, y: c.y, kind: 'moment' });
  for (const h of problem.hinges ?? []) pts.push({ x: h.x, y: h.y, kind: 'hinge' });
  for (const d of problem.distributed) pts.push({ x: d.x1, y: d.y1, kind: 'distributed' }, { x: d.x2, y: d.y2, kind: 'distributed' });
  return pts.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
}

/** Sorted values with near-duplicates merged. */
export function uniqueSorted(values, tol = 1e-6) {
  const out = [];
  for (const v of [...values].sort((a, b) => a - b)) {
    if (out.length === 0 || v - out[out.length - 1] > tol) out.push(v);
  }
  return out;
}

/** The distinct x and y positions that dimension chains run between. */
export function dimensionChains(problem) {
  const points = definedPoints(problem);
  return {
    points,
    xs: uniqueSorted(points.map((p) => p.x)),
    ys: uniqueSorted(points.map((p) => p.y)),
  };
}

/** Bounding box of everything defined, or null for an empty problem. */
export function boundsOf(problem) {
  const pts = definedPoints(problem);
  if (pts.length === 0) return null;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}
