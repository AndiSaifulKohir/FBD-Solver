import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { solve, resolveLoads } from '../js/solver.js';
import { internalForces } from '../js/internal.js';
import { normalizeProblem } from '../js/model.js';

const near = (actual, expected, label, eps = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < eps, `${label}: expected ${expected}, got ${actual}`);

const value = (solution, label) => solution.unknowns.find((k) => k.label === label).value;

const beam = (load, length = 6) =>
  normalizeProblem({
    members: [{ x1: 0, y1: 0, x2: length, y2: 0 }],
    supports: [
      { type: 'pin', x: 0, y: 0 },
      { type: 'roller', x: length, y: 0, angle: 90 },
    ],
    distributed: [{ y1: 0, y2: 0, angle: 270, ...load }],
  });

const examples = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'examples');
const example = async (name) => normalizeProblem(JSON.parse(await readFile(path.join(examples, name), 'utf8')));

/* ---------- reactions ---------- */

test('triangular load growing from zero: reactions are wL/6 and wL/3', () => {
  // 0 to 6 kN/m over 6 m: total 18 kN acting 4 m from the start.
  const s = solve(beam({ x1: 0, x2: 6, w: 0, w2: 6 }));
  assert.equal(s.status, 'solved');
  near(value(s, 'Ay'), 6, 'Ay');
  near(value(s, 'B'), 12, 'B');
  assert.ok(s.check.ok);
});

test('the mirrored triangle swaps the reactions', () => {
  const s = solve(beam({ x1: 0, x2: 6, w: 6, w2: 0 }));
  near(value(s, 'Ay'), 12, 'Ay');
  near(value(s, 'B'), 6, 'B');
});

test('a load drawn right to left means the same as the same load drawn left to right', () => {
  // Starts at x = 6 with 0, ends at x = 0 with 6: intensity is 6 at the left.
  const s = solve(beam({ x1: 6, x2: 0, w: 0, w2: 6 }));
  near(value(s, 'Ay'), 12, 'Ay');
  near(value(s, 'B'), 6, 'B');
});

test('partial trapezoid: 2 to 6 kN/m between x = 2 and x = 6 on an 8 m beam', async () => {
  const s = solve(await example('beam-trapezoid.json'));
  // Total 16 kN. Its centroid is 2 + 4(2 + 12)/(3 x 8) = 13/3 from the left.
  near(value(s, 'B'), 26 / 3, 'B');
  near(value(s, 'Ay'), 22 / 3, 'Ay');
  assert.ok(s.check.ok);
});

test('a load whose intensity changes sign has no net force but still a moment', () => {
  // -3 to +3 over 6 m: the two halves form a couple.
  const s = solve(beam({ x1: 0, x2: 6, w: -3, w2: 3 }));
  assert.equal(s.status, 'solved');
  near(value(s, 'B'), 3, 'B');
  near(value(s, 'Ay'), -3, 'Ay');
  assert.ok(s.check.ok);
  const [w] = s.loads.distributed;
  near(w.total, 0, 'net force');
});

test('leaving out w2 gives a uniform load, as before', () => {
  const p = normalizeProblem({
    members: [{ x1: 0, y1: 0, x2: 6, y2: 0 }],
    supports: [{ type: 'pin', x: 0, y: 0 }, { type: 'roller', x: 6, y: 0, angle: 90 }],
    distributed: [{ x1: 0, y1: 0, x2: 6, y2: 0, w: 5 }],
  });
  assert.equal(p.distributed[0].w2, 5);
  const s = solve(p);
  near(value(s, 'Ay'), 15, 'Ay');
  near(value(s, 'B'), 15, 'B');
});

test('cantilever with a triangular load: reaction moment is wL^2/6 x ... by hand', () => {
  // 0 to 8 kN/m over 4 m from the wall: total 16 kN at 8/3 m. Moment 16 x 8/3.
  const s = solve(
    normalizeProblem({
      members: [{ x1: 0, y1: 0, x2: 4, y2: 0 }],
      supports: [{ type: 'fixed', x: 0, y: 0 }],
      distributed: [{ x1: 0, y1: 0, x2: 4, y2: 0, w: 0, w2: 8 }],
    })
  );
  near(value(s, 'Ay'), 16, 'Ay');
  near(value(s, 'MA'), (16 * 8) / 3, 'MA');
});

test('resultant for display: total force and where it acts', () => {
  const [w] = solve(beam({ x1: 0, x2: 6, w: 0, w2: 6 })).loads.distributed;
  near(w.total, 18, 'total');
  near(w.x, 4, 'position');
  assert.equal(w.label, 'W1');
});

test('a sloped load on an inclined direction resolves into components', () => {
  const { forces } = resolveLoads(
    normalizeProblem({ distributed: [{ x1: 0, y1: 0, x2: 4, y2: 0, w: 2, w2: 2, angle: 0 }] })
  );
  const fx = forces.reduce((a, f) => a + f.fx, 0);
  const fy = forces.reduce((a, f) => a + f.fy, 0);
  near(fx, 8, 'Fx');
  near(fy, 0, 'Fy');
});

/* ---------- shear and moment under a sloped load ---------- */

test('triangular load: the moment peaks at L/sqrt(3) with value wL^2 / (9 sqrt(3))', () => {
  const p = beam({ x1: 0, x2: 6, w: 0, w2: 6 });
  const inf = internalForces(p, solve(p));
  assert.equal(inf.status, 'ok');
  near(inf.summary.M.max.value, (6 * 36) / (9 * Math.sqrt(3)), 'max M', 1e-6);
  near(inf.summary.M.max.x, 6 / Math.sqrt(3), 'where it peaks', 1e-6);
});

test('shear under a sloped load starts at the left reaction and ends at minus the right one', () => {
  const p = beam({ x1: 0, x2: 6, w: 0, w2: 6 });
  const s = solve(p);
  const [m] = internalForces(p, s).members;
  near(m.stations[0].V, 6, 'V at the left support');
  near(m.stations.at(-1).V, -12, 'V at the right support');
  near(m.stations[0].M, 0, 'M at the left support');
  near(m.stations.at(-1).M, 0, 'M at the right support', 1e-9);
});

test('a partial trapezoid keeps the moment continuous where the load starts and stops', async () => {
  const p = await example('beam-trapezoid.json');
  const inf = internalForces(p, solve(p));
  const m = inf.members[0];
  const at = (s) => m.stations.filter((st) => Math.abs(st.s - s) < 1e-9);
  near(at(2)[0].M, at(2).at(-1).M, 'M continuous at x = 2');
  near(at(6)[0].M, at(6).at(-1).M, 'M continuous at x = 6');
  near(m.stations.at(-1).M, 0, 'M at the right support', 1e-9);
});

test('a sloped load across a hinge: moment is zero at the hinge', () => {
  const p = normalizeProblem({
    members: [
      { x1: 0, y1: 0, x2: 0, y2: 4 },
      { x1: 0, y1: 4, x2: 6, y2: 4 },
      { x1: 6, y1: 4, x2: 6, y2: 0 },
    ],
    supports: [{ type: 'pin', x: 0, y: 0 }, { type: 'pin', x: 6, y: 0 }],
    distributed: [{ x1: 0, y1: 4, x2: 6, y2: 4, w: 1, w2: 5 }],
    hinges: [{ x: 3, y: 4 }],
  });
  const s = solve(p);
  assert.equal(s.status, 'solved');
  assert.ok(s.check.ok);
  const inf = internalForces(p, s);
  const [, leftBeam, rightBeam] = inf.members;
  near(leftBeam.stations.at(-1).M, 0, 'M at the end of the left half', 1e-9);
  near(rightBeam.stations[0].M, 0, 'M at the start of the right half', 1e-9);
});
