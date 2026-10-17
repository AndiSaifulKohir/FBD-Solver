import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { solve } from '../js/solver.js';
import { internalForces } from '../js/internal.js';
import { normalizeProblem } from '../js/model.js';

const near = (actual, expected, label, eps = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < eps, `${label}: expected ${expected}, got ${actual}`);

const value = (solution, label) => {
  const u = solution.unknowns.find((k) => k.label === label);
  assert.ok(u, `no unknown named ${label}`);
  return u.value;
};

const examples = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'examples');
const portal = async () =>
  normalizeProblem(JSON.parse(await readFile(path.join(examples, 'three-hinged-portal.json'), 'utf8')));

test('three-hinged portal: reactions by hand', async () => {
  const s = solve(await portal());
  assert.equal(s.status, 'solved');
  near(value(s, 'Ax'), -0.625, 'Ax');
  near(value(s, 'Ay'), 11 / 3, 'Ay');
  near(value(s, 'Bx'), -7.375, 'Bx');
  near(value(s, 'By'), 43 / 3, 'By');
  assert.ok(s.check.ok);
  assert.equal(s.degrees.equations, 4);
  assert.match(s.message, /4 unknowns, 4 equations/);
  assert.ok(s.system.rows.some((r) => r.name.startsWith('ΣM(H1')));
});

test('the same portal without the hinge is statically indeterminate', async () => {
  const p = await portal();
  p.hinges = [];
  assert.equal(solve(p).status, 'indeterminate');
});

test('bending moment is zero at the hinge', async () => {
  const p = await portal();
  const inf = internalForces(p, solve(p));
  assert.equal(inf.status, 'ok');
  // The beam is split at the hinge into two segments that meet at x = 3.
  const [leftColumn, leftBeam, rightBeam] = inf.members;
  near(leftBeam.stations.at(-1).M, 0, 'M at the end of the left half', 1e-9);
  near(rightBeam.stations[0].M, 0, 'M at the start of the right half', 1e-9);
  near(leftColumn.stations.at(-1).M, leftBeam.stations[0].M, 'moment continues around the left knee');
});

test('hinge at a joint, not in a member', () => {
  // Two-hinged frame with a third hinge at the ridge joint.
  const p = normalizeProblem({
    members: [
      { x1: 0, y1: 0, x2: 0, y2: 4 },
      { x1: 0, y1: 4, x2: 3, y2: 6 },
      { x1: 3, y1: 6, x2: 6, y2: 4 },
      { x1: 6, y1: 4, x2: 6, y2: 0 },
    ],
    supports: [
      { type: 'pin', x: 0, y: 0 },
      { type: 'pin', x: 6, y: 0 },
    ],
    forces: [{ x: 3, y: 6, magnitude: 10, angle: 270 }],
    hinges: [{ x: 3, y: 6 }],
  });
  const s = solve(p);
  assert.equal(s.status, 'solved');
  // Symmetric load on a symmetric three-hinged frame: equal vertical reactions, equal and opposite thrusts.
  near(value(s, 'Ay'), 5, 'Ay');
  near(value(s, 'By'), 5, 'By');
  near(value(s, 'Ax'), -value(s, 'Bx'), 'horizontal thrusts are equal and opposite');
  // Moment about the ridge of the left half: -3*Ay + 6*Ax = 0, so the pins push inward by Ay/2.
  near(value(s, 'Ax'), 2.5, 'Ax');
  near(value(s, 'Bx'), -2.5, 'Bx');
});

test('Gerber beam: a hinge makes a continuous beam on three supports determinate', () => {
  const raw = {
    members: [{ x1: 0, y1: 0, x2: 10, y2: 0 }],
    supports: [
      { type: 'pin', x: 0, y: 0 },
      { type: 'roller', x: 6, y: 0, angle: 90 },
      { type: 'roller', x: 10, y: 0, angle: 90 },
    ],
    forces: [
      { x: 3, y: 0, magnitude: 12, angle: 270 },
      { x: 9, y: 0, magnitude: 10, angle: 270 },
    ],
  };

  // Without a hinge: 4 unknowns, 3 equations.
  assert.equal(solve(normalizeProblem(raw)).status, 'indeterminate');

  // Hinge at x = 8. The right part is only the roller C and the 10 kN load:
  // moment about the hinge gives 2*C - 10*1 = 0, so C = 5.
  const s = solve(normalizeProblem({ ...raw, hinges: [{ x: 8, y: 0 }] }));
  assert.equal(s.status, 'solved');
  near(value(s, 'Ax'), 0, 'Ax');
  near(value(s, 'C'), 5, 'C');
  near(value(s, 'B'), 76 / 6, 'B');
  near(value(s, 'Ay'), 17 - 76 / 6, 'Ay');
  assert.ok(s.check.ok);

  const inf = internalForces(normalizeProblem({ ...raw, hinges: [{ x: 8, y: 0 }] }), s);
  assert.equal(inf.status, 'ok');
  const [left, right] = inf.members;
  near(left.stations.at(-1).M, 0, 'M just left of the hinge');
  near(right.stations[0].M, 0, 'M just right of the hinge');
});

test('a straight beam with a hinge and only two end pins is a mechanism', () => {
  const s = solve(
    normalizeProblem({
      members: [{ x1: 0, y1: 0, x2: 8, y2: 0 }],
      supports: [
        { type: 'pin', x: 0, y: 0 },
        { type: 'pin', x: 8, y: 0 },
      ],
      forces: [{ x: 2, y: 0, magnitude: 10, angle: 270 }],
      hinges: [{ x: 4, y: 0 }],
    })
  );
  assert.equal(s.status, 'unstable');
  assert.match(s.message, /cannot balance/);
});

test('hinge problems are reported clearly', async () => {
  const p = await portal();

  const off = structuredClone(p);
  off.hinges = [{ id: 'h', x: 3, y: 1 }];
  const a = solve(off);
  assert.equal(a.status, 'incomplete');
  assert.match(a.message, /hinge is not on a member/);

  const couple = structuredClone(p);
  couple.moments = [{ id: 'c', x: 3, y: 4, value: 5 }];
  assert.match(solve(couple).message, /moment cannot be placed at a hinge/);

  const fixed = structuredClone(p);
  fixed.supports = [{ id: 'f', type: 'fixed', x: 0, y: 0 }, { id: 'r', type: 'pin', x: 3, y: 4 }];
  // pin at the hinge is fine; a fixed support at the hinge is not
  fixed.supports[0] = { id: 'f', type: 'fixed', x: 3, y: 4 };
  assert.match(solve(fixed).message, /fixed support cannot be placed at a hinge/);
});

test('a hinge in a closed loop is reported', () => {
  const p = normalizeProblem({
    members: [
      { x1: 0, y1: 0, x2: 4, y2: 0 },
      { x1: 4, y1: 0, x2: 4, y2: 4 },
      { x1: 4, y1: 4, x2: 0, y2: 4 },
      { x1: 0, y1: 4, x2: 0, y2: 0 },
    ],
    supports: [
      { type: 'pin', x: 0, y: 0 },
      { type: 'roller', x: 4, y: 0, angle: 90 },
    ],
    hinges: [{ x: 2, y: 4 }],
  });
  const s = solve(p);
  assert.equal(s.status, 'incomplete');
  assert.match(s.message, /closed loop/);
});

test('a member that meets another in a T is split there', () => {
  const p = normalizeProblem({
    members: [
      { x1: 0, y1: 0, x2: 6, y2: 0 },
      { x1: 3, y1: 0, x2: 3, y2: 3 },
    ],
    supports: [
      { type: 'pin', x: 0, y: 0 },
      { type: 'roller', x: 6, y: 0, angle: 90 },
    ],
    forces: [{ x: 3, y: 3, magnitude: 6, angle: 270 }],
  });
  const inf = internalForces(p, solve(p));
  assert.equal(inf.status, 'ok');
  assert.equal(inf.members.length, 3);
});
