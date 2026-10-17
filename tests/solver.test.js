import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { solve } from '../js/solver.js';
import { analyze } from '../js/analysis.js';
import { normalizeProblem } from '../js/model.js';
import { equationText, fmt } from '../js/format.js';

const near = (actual, expected, label, eps = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < eps, `${label}: expected ${expected}, got ${actual}`);

const value = (solution, label) => {
  const u = solution.unknowns.find((k) => k.label === label);
  assert.ok(u, `no unknown named ${label}`);
  return u.value;
};

const pinRoller = (length, extra = {}) =>
  normalizeProblem({
    supports: [
      { type: 'pin', x: 0, y: 0 },
      { type: 'roller', x: length, y: 0, angle: 90 },
    ],
    ...extra,
  });

/* ---------- textbook problems ---------- */

test('simply supported beam, centred point load', () => {
  const s = solve(pinRoller(6, { forces: [{ x: 3, y: 0, magnitude: 10, angle: 270 }] }));
  assert.equal(s.status, 'solved');
  near(value(s, 'Ax'), 0, 'Ax');
  near(value(s, 'Ay'), 5, 'Ay');
  near(value(s, 'B'), 5, 'B');
});

test('simply supported beam, off-centre point load', () => {
  const s = solve(pinRoller(6, { forces: [{ x: 2, y: 0, magnitude: 12, angle: 270 }] }));
  near(value(s, 'Ay'), 8, 'Ay');
  near(value(s, 'B'), 4, 'B');
});

test('inclined load: horizontal component goes to the pin', () => {
  const s = solve(pinRoller(4, { forces: [{ x: 2, y: 0, magnitude: 10, angle: 45 }] }));
  const c = 10 * Math.SQRT1_2;
  near(value(s, 'Ax'), -c, 'Ax');
  near(value(s, 'B'), -c / 2, 'B');
  near(value(s, 'Ay'), -c / 2, 'Ay');
});

test('applied couple is balanced by a pair of vertical reactions', () => {
  const s = solve(pinRoller(4, { moments: [{ x: 2, y: 0, value: 20 }] }));
  near(value(s, 'B'), -5, 'B');
  near(value(s, 'Ay'), 5, 'Ay');
});

test('cantilever with uniformly distributed load', () => {
  const s = solve(
    normalizeProblem({
      supports: [{ type: 'fixed', x: 0, y: 0 }],
      distributed: [{ x1: 0, y1: 0, x2: 4, y2: 0, w: 5, angle: 270 }],
    })
  );
  assert.equal(s.status, 'solved');
  near(value(s, 'Ax'), 0, 'Ax');
  near(value(s, 'Ay'), 20, 'Ay');
  near(value(s, 'MA'), 40, 'MA');
});

test('roller on an incline reacts along its own normal', () => {
  // Roller whose normal points at 135 degrees, load 10 kN down at the pin point.
  const s = solve(
    normalizeProblem({
      supports: [
        { type: 'pin', x: 0, y: 0 },
        { type: 'roller', x: 4, y: 0, angle: 135 },
      ],
      forces: [{ x: 4, y: 0, magnitude: 10, angle: 270 }],
    })
  );
  assert.equal(s.status, 'solved');
  assert.ok(s.check.ok);
});

/* ---------- the equilibrium check ---------- */

test('every solved problem sums to zero force and zero moment', () => {
  const s = solve(
    pinRoller(7, {
      forces: [
        { x: 1.5, y: 0, magnitude: 7, angle: 250 },
        { x: 5, y: 2, magnitude: 3, angle: 10 },
      ],
      moments: [{ x: 3, y: 0, value: -8 }],
      distributed: [{ x1: 2, y1: 0, x2: 6, y2: 0, w: 2.5, angle: 270 }],
    })
  );
  assert.equal(s.status, 'solved');
  assert.ok(s.check.ok);
  near(s.check.fx, 0, 'sum Fx', 1e-9);
  near(s.check.fy, 0, 'sum Fy', 1e-9);
  for (const m of s.check.moments) near(m.value, 0, 'sum M', 1e-9);
});

/* ---------- problem classification ---------- */

test('no supports is incomplete', () => {
  const s = solve(normalizeProblem({ forces: [{ x: 0, y: 0, magnitude: 5, angle: 270 }] }));
  assert.equal(s.status, 'incomplete');
});

test('four or more unknowns is statically indeterminate', () => {
  const s = solve(
    normalizeProblem({
      supports: [
        { type: 'pin', x: 0, y: 0 },
        { type: 'pin', x: 6, y: 0 },
      ],
      forces: [{ x: 3, y: 0, magnitude: 10, angle: 270 }],
    })
  );
  assert.equal(s.status, 'indeterminate');
});

test('a roller with horizontal reaction cannot carry a vertical load', () => {
  const s = solve(
    normalizeProblem({
      supports: [
        { type: 'pin', x: 0, y: 0 },
        { type: 'roller', x: 4, y: 0, angle: 0 },
      ],
      forces: [{ x: 3, y: 0, magnitude: 10, angle: 270 }],
    })
  );
  assert.equal(s.status, 'unstable');
});

test('parallel vertical reactions with a horizontal load are unstable', () => {
  const s = solve(
    normalizeProblem({
      supports: [
        { type: 'roller', x: 0, y: 0, angle: 90 },
        { type: 'roller', x: 4, y: 0, angle: 90 },
      ],
      forces: [{ x: 2, y: 0, magnitude: 5, angle: 0 }],
    })
  );
  assert.equal(s.status, 'unstable');
});

test('partial restraint solves but carries a warning', () => {
  const s = solve(
    normalizeProblem({
      supports: [{ type: 'roller', x: 0, y: 0, angle: 90 }],
      forces: [{ x: 0, y: 0, magnitude: 10, angle: 270 }],
    })
  );
  assert.equal(s.status, 'solved');
  assert.ok(s.warning);
  near(value(s, 'A'), 10, 'A');
});

test('a body with no loads has zero reactions', () => {
  const s = solve(pinRoller(5));
  assert.equal(s.status, 'solved');
  for (const u of s.unknowns) near(u.value, 0, u.label);
});

/* ---------- example files ---------- */

const examplesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'examples');

test('portal frame example', async () => {
  const p = normalizeProblem(JSON.parse(await readFile(path.join(examplesDir, 'portal-frame.json'), 'utf8')));
  const s = solve(p);
  near(value(s, 'Ax'), -8, 'Ax');
  near(value(s, 'B'), 43 / 3, 'B');
  near(value(s, 'Ay'), 11 / 3, 'Ay');
});

test('cantilever example', async () => {
  const p = normalizeProblem(JSON.parse(await readFile(path.join(examplesDir, 'cantilever-udl.json'), 'utf8')));
  const s = solve(p);
  near(value(s, 'Ay'), 28, 'Ay');
  near(value(s, 'MA'), 72, 'MA');
});

test('inclined load example', async () => {
  const p = normalizeProblem(JSON.parse(await readFile(path.join(examplesDir, 'inclined-load.json'), 'utf8')));
  const s = solve(p);
  const fy = 20 * Math.sin(Math.PI / 3);
  near(value(s, 'Ax'), -10, 'Ax');
  near(value(s, 'B'), (3 * fy) / 8, 'B');
  near(value(s, 'Ay'), fy - (3 * fy) / 8, 'Ay');
});

test('overhanging beam with moment example', async () => {
  const p = normalizeProblem(JSON.parse(await readFile(path.join(examplesDir, 'overhanging-beam.json'), 'utf8')));
  const s = solve(p);
  near(value(s, 'B'), 28 / 6, 'B');
  near(value(s, 'Ay'), 6 - 28 / 6, 'Ay');
});

test('every example file solves and passes the equilibrium check', async () => {
  const files = (await readdir(examplesDir)).filter((f) => f.endsWith('.json'));
  assert.ok(files.length >= 9);
  for (const file of files) {
    const p = normalizeProblem(JSON.parse(await readFile(path.join(examplesDir, file), 'utf8')));
    const s = analyze(p);
    assert.equal(s.status, 'solved', `${file} should be solvable`);
    assert.ok(s.check.ok, `${file} should balance`);
  }
});

/* ---------- validation and formatting ---------- */

test('normalizeProblem rejects bad input with a readable message', () => {
  assert.throws(() => normalizeProblem(null), /JSON object/);
  assert.throws(() => normalizeProblem({ supports: [{ type: 'spring', x: 0, y: 0 }] }), /type must be one of/);
  assert.throws(() => normalizeProblem({ forces: [{ x: 'a', y: 0, magnitude: 1 }] }), /forces\[0\]\.x must be a number/);
  assert.throws(() => normalizeProblem({ members: 'nope' }), /must be a list/);
});

test('normalizeProblem fills in ids and defaults', () => {
  const p = normalizeProblem({
    supports: [{ type: 'roller', x: 1, y: 2 }],
    forces: [{ x: 0, y: 0, magnitude: 3 }],
  });
  assert.ok(p.supports[0].id);
  assert.equal(p.supports[0].angle, 90);
  assert.equal(p.forces[0].angle, 270);
});

test('display formatting rounds for display only', () => {
  assert.equal(fmt(4.9999999999), '5');
  assert.equal(fmt(-0.0000001), '0');
  assert.equal(fmt(2.5), '2.5');
  assert.equal(fmt(-7.0710678), '−7.071');
  const row = { coeffs: [1, 0, -1, 6], known: -10 };
  assert.equal(equationText(row, ['Ax', 'Ay', 'By', 'C']), 'Ax − By + 6·C − 10');
});
