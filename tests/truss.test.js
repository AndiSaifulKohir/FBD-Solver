import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { solveTruss, trussAxial } from '../js/truss.js';
import { renderDiagram } from '../js/draw.js';
import { analyze } from '../js/analysis.js';
import { normalizeProblem } from '../js/model.js';

const near = (actual, expected, label, eps = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < eps, `${label}: expected ${expected}, got ${actual}`);

const truss = (raw) => solveTruss(normalizeProblem({ mode: 'truss', ...raw }));
const bar = (s, label) => s.bars.find((b) => b.label === label);

const examples = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'examples');
const example = async (name) => normalizeProblem(JSON.parse(await readFile(path.join(examples, name), 'utf8')));

/* ---------- textbook trusses ---------- */

test('triangular truss: reactions and bar forces by hand', async () => {
  const s = solveTruss(await example('truss-triangle.json'));
  assert.equal(s.status, 'solved');
  near(s.reactions[0].fy, 6, 'Ay');
  near(s.reactions[1].fy, 6, 'B');
  near(s.reactions[0].fx, 0, 'Ax');

  // Joint A: vertical balance gives the sloping bar, horizontal gives the chord.
  near(bar(s, 'B1').force, 4, 'bottom chord is in tension');
  near(bar(s, 'B2').force, -2 * Math.sqrt(13), 'left sloping bar is in compression');
  near(bar(s, 'B3').force, -2 * Math.sqrt(13), 'right sloping bar is in compression');
  assert.equal(bar(s, 'B1').state, 'tension');
  assert.equal(bar(s, 'B2').state, 'compression');
  assert.match(s.message, /3 bars \+ 3 reactions = 2 × 3 joints/);
});

test('Warren truss: first bay by hand', async () => {
  const s = solveTruss(await example('truss-warren.json'));
  assert.equal(s.status, 'solved');
  near(s.reactions[0].fy, 10, 'Ay');
  near(s.reactions[1].fy, 10, 'B');
  near(bar(s, 'B8').force, -5 * Math.sqrt(5), 'end diagonal');
  near(bar(s, 'B1').force, 5, 'first bottom chord');
  near(bar(s, 'B15').force, -5 * Math.sqrt(5), 'mirror end diagonal');
  assert.equal(s.degrees.bars + s.degrees.reactions, 2 * s.degrees.joints);
});

test('an unloaded three-bar joint with two collinear bars has a zero-force bar', () => {
  const s = truss({
    members: [
      { x1: 0, y1: 0, x2: 2, y2: 0 },
      { x1: 2, y1: 0, x2: 4, y2: 0 },
      { x1: 0, y1: 0, x2: 2, y2: 3 },
      { x1: 4, y1: 0, x2: 2, y2: 3 },
      { x1: 2, y1: 0, x2: 2, y2: 3 },
    ],
    supports: [
      { type: 'pin', x: 0, y: 0 },
      { type: 'roller', x: 4, y: 0, angle: 90 },
    ],
    forces: [{ x: 2, y: 3, magnitude: 12, angle: 270 }],
  });
  assert.equal(s.status, 'solved');
  assert.equal(bar(s, 'B5').state, 'zero');
});

test('a horizontal load is carried by the pin', () => {
  const s = truss({
    members: [
      { x1: 0, y1: 0, x2: 4, y2: 0 },
      { x1: 0, y1: 0, x2: 2, y2: 3 },
      { x1: 4, y1: 0, x2: 2, y2: 3 },
    ],
    supports: [
      { type: 'pin', x: 0, y: 0 },
      { type: 'roller', x: 4, y: 0, angle: 90 },
    ],
    forces: [{ x: 2, y: 3, magnitude: 6, angle: 0 }],
  });
  near(s.reactions[0].fx, -6, 'Ax');
  near(s.reactions[0].fy, -6 * 3 / 4, 'Ay');
  near(s.reactions[1].fy, 6 * 3 / 4, 'B');
});

test('every joint balances after solving', async () => {
  for (const file of ['truss-triangle.json', 'truss-warren.json']) {
    const s = solveTruss(await example(file));
    assert.ok(s.check.ok, file);
    assert.ok(s.check.worstJoint < 1e-9, `${file} joint residual ${s.check.worstJoint}`);
  }
});

/* ---------- classification ---------- */

const square = [
  { x1: 0, y1: 0, x2: 4, y2: 0 },
  { x1: 4, y1: 0, x2: 4, y2: 4 },
  { x1: 4, y1: 4, x2: 0, y2: 4 },
  { x1: 0, y1: 4, x2: 0, y2: 0 },
];
const squareSupports = [
  { type: 'pin', x: 0, y: 0 },
  { type: 'roller', x: 4, y: 0, angle: 90 },
];

test('a square of four bars is a mechanism', () => {
  const s = truss({ members: square, supports: squareSupports, forces: [{ x: 0, y: 4, magnitude: 5, angle: 0 }] });
  assert.equal(s.status, 'unstable');
});

test('two diagonals make the square indeterminate', () => {
  const s = truss({
    members: [...square, { x1: 0, y1: 0, x2: 4, y2: 4 }, { x1: 4, y1: 0, x2: 0, y2: 4 }],
    supports: squareSupports,
    forces: [{ x: 0, y: 4, magnitude: 5, angle: 0 }],
  });
  assert.equal(s.status, 'indeterminate');
  assert.match(s.message, /degree 1/);
});

test('one diagonal makes the square a determinate truss', () => {
  const s = truss({
    members: [...square, { x1: 0, y1: 0, x2: 4, y2: 4 }],
    supports: squareSupports,
    forces: [{ x: 0, y: 4, magnitude: 5, angle: 0 }],
  });
  assert.equal(s.status, 'solved');
  assert.ok(s.check.ok);
});

test('trusses reject frame-only items with a clear message', () => {
  const base = { members: square, supports: squareSupports };
  assert.match(truss({ ...base, moments: [{ x: 0, y: 0, value: 5 }] }).message, /applied moments/);
  assert.match(truss({ ...base, distributed: [{ x1: 0, y1: 0, x2: 4, y2: 0, w: 1 }] }).message, /distributed loads/);
  assert.match(truss({ ...base, hinges: [{ x: 2, y: 0 }] }).message, /hinges/);
  assert.match(
    truss({ members: square, supports: [{ type: 'fixed', x: 0, y: 0 }] }).message,
    /fixed supports/
  );
});

test('loads and supports must sit at joints', () => {
  const s = truss({
    members: [{ x1: 0, y1: 0, x2: 4, y2: 0 }, { x1: 0, y1: 0, x2: 2, y2: 3 }, { x1: 4, y1: 0, x2: 2, y2: 3 }],
    supports: [{ type: 'pin', x: 0, y: 0 }, { type: 'roller', x: 4, y: 0, angle: 90 }],
    forces: [{ x: 1, y: 0, magnitude: 5, angle: 270 }],
  });
  assert.equal(s.status, 'unsupported');
  assert.match(s.message, /not at a joint/);
});

test('no bars or no supports is incomplete', () => {
  assert.equal(truss({ supports: squareSupports }).status, 'incomplete');
  assert.equal(truss({ members: square }).status, 'incomplete');
});

test('a truss with disconnected bars is invalid', () => {
  const s = truss({
    members: [...square, { x1: 8, y1: 0, x2: 10, y2: 0 }],
    supports: squareSupports,
  });
  assert.equal(s.status, 'invalid');
  assert.match(s.message, /Truss members are not connected/);
});

test('a zero-length truss bar is invalid', () => {
  const s = truss({
    members: [{ x1: 0, y1: 0, x2: 0, y2: 0 }],
    supports: [{ type: 'pin', x: 0, y: 0 }],
  });
  assert.equal(s.status, 'invalid');
  assert.match(s.message, /zero length/);
});

test('analyze picks the solver from the mode', async () => {
  const t = analyze(await example('truss-triangle.json'));
  assert.equal(t.mode, 'truss');
  const f = analyze(await example('simply-supported-beam.json'));
  assert.equal(f.mode, undefined);
  assert.equal(f.status, 'solved');
});

test('normal force diagram: one constant value per bar, equal to the bar force', async () => {
  const problem = await example('truss-triangle.json');
  const s = solveTruss(problem);
  const axial = trussAxial(problem, s);
  assert.equal(axial.status, 'ok');
  assert.equal(axial.members.length, 3);
  axial.members.forEach((m, k) => {
    for (const st of m.stations) near(st.N, s.bars[k].force, `bar ${k + 1}`);
  });
  near(axial.summary.N.max.value, 4, 'largest tension');
  near(axial.summary.N.min.value, -2 * Math.sqrt(13), 'largest compression');

  const svg = renderDiagram(problem, s, axial, 'N');
  assert.ok(!/NaN|undefined|Infinity/.test(svg));
  assert.ok(svg.includes('fm-pos') && svg.includes('fm-neg'), 'tension and compression bars are drawn');
});

test('normal force diagram needs a solved truss', () => {
  const problem = normalizeProblem({ mode: 'truss', members: square });
  const axial = trussAxial(problem, solveTruss(problem));
  assert.equal(axial.status, 'unavailable');
});
