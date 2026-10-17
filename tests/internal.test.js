import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { solve } from '../js/solver.js';
import { normalizeProblem } from '../js/model.js';
import { internalForces } from '../js/internal.js';
import { renderDiagram } from '../js/draw.js';

const near = (actual, expected, label, eps = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < eps, `${label}: expected ${expected}, got ${actual}`);

const run = (raw) => {
  const problem = normalizeProblem(raw);
  const solution = solve(problem);
  return { problem, solution, inf: internalForces(problem, solution) };
};

/** Stations at distance s along a member (two of them at a point load). */
const at = (member, s) => member.stations.filter((st) => Math.abs(st.s - s) < 1e-9);

const examples = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'examples');
const example = async (name) => run(JSON.parse(await readFile(path.join(examples, name), 'utf8')));

const beam = (extra, from = [0, 0], to = [6, 0]) => ({
  members: [{ x1: from[0], y1: from[1], x2: to[0], y2: to[1] }],
  supports: [
    { type: 'pin', x: 0, y: 0 },
    { type: 'roller', x: 6, y: 0, angle: 90 },
  ],
  ...extra,
});

/* ---------- beams ---------- */

test('simply supported beam with a point load', () => {
  const { inf } = run(beam({ forces: [{ x: 2, y: 0, magnitude: 12, angle: 270 }] }));
  assert.equal(inf.status, 'ok');
  const m = inf.members[0];

  near(at(m, 0)[0].V, 8, 'V at left support');
  const [before, after] = at(m, 2);
  near(before.V, 8, 'V just left of load');
  near(after.V, -4, 'V just right of load');
  near(before.M, 16, 'M under load');
  near(after.M, 16, 'M under load, right side');
  near(at(m, 0)[0].M, 0, 'M at left support');
  near(at(m, 6).at(-1).M, 0, 'M at right support');
  for (const st of m.stations) near(st.N, 0, 'N');

  near(inf.summary.M.max.value, 16, 'max M');
  near(inf.summary.M.max.x, 2, 'max M position');
  near(inf.summary.V.max.value, 8, 'max V');
  near(inf.summary.V.min.value, -4, 'min V');
});

test('uniformly loaded beam peaks at wL^2/8 at midspan', async () => {
  const { inf } = await example('beam-udl.json');
  assert.equal(inf.status, 'ok');
  near(inf.summary.M.max.value, (5 * 36) / 8, 'max M');
  near(inf.summary.M.max.x, 3, 'max M position');
  const m = inf.members[0];
  near(at(m, 0)[0].V, 15, 'V at left');
  near(at(m, 6).at(-1).V, -15, 'V at right');
});

test('cantilever: shear and moment at the fixed end and the tip', async () => {
  const { inf } = await example('cantilever-udl.json');
  const m = inf.members[0];
  near(at(m, 0)[0].V, 28, 'V at wall');
  near(at(m, 0)[0].M, -72, 'M at wall (hogging)');
  near(at(m, 4).at(-1).V, 8, 'V at tip equals the tip load');
  near(at(m, 4).at(-1).M, 0, 'M at tip');
});

test('applied couple makes a jump in the moment diagram', async () => {
  const { inf } = await example('overhanging-beam.json');
  const m = inf.members[0];
  const [before, after] = at(m, 3);
  near(after.M - before.M, -20, 'jump equals minus the couple');
});

test('inclined load: normal force is tension up to the load, then zero', async () => {
  const { inf } = await example('inclined-load.json');
  const m = inf.members[0];
  near(at(m, 1)[0].N, 10, 'N before the load');
  near(m.stations.at(-1).N, 0, 'N after the load');
});

test('the drawing direction of a member does not change N, V or M', () => {
  const load = { forces: [{ x: 2, y: 0, magnitude: 12, angle: 270 }] };
  const forward = run(beam(load)).inf.summary;
  const reversed = run(beam(load, [6, 0], [0, 0])).inf.summary;
  for (const key of ['N', 'V', 'M']) {
    near(reversed[key].max.value, forward[key].max.value, `${key} max`);
    near(reversed[key].min.value, forward[key].min.value, `${key} min`);
  }
  near(reversed.M.max.x, 2, 'max M position');
});

test('a column drawn top-down gives the same diagrams as one drawn bottom-up', () => {
  const column = (from, to) =>
    run({
      members: [{ x1: from[0], y1: from[1], x2: to[0], y2: to[1] }],
      supports: [{ type: 'fixed', x: 0, y: 0 }],
      forces: [{ x: 0, y: 4, magnitude: 6, angle: 0 }],
    }).inf.summary;
  const up = column([0, 0], [0, 4]);
  const down = column([0, 4], [0, 0]);
  for (const key of ['N', 'V', 'M']) {
    near(down[key].max.value, up[key].max.value, `${key} max`);
    near(down[key].min.value, up[key].min.value, `${key} min`);
  }
  near(up.M.min.value, -24, 'cantilever column moment at the base');
});

/* ---------- frames ---------- */

test('portal frame: moment is continuous at the knees, normal force in the columns', async () => {
  const { inf } = await example('portal-frame.json');
  assert.equal(inf.status, 'ok');
  const [leftColumn, beamMember, rightColumn] = inf.members;

  near(at(leftColumn, 0)[0].N, -11 / 3, 'left column is in compression');
  near(leftColumn.stations.at(-1).M, 32, 'M at the top of the left column');
  near(beamMember.stations[0].M, 32, 'M at the start of the beam');
  near(beamMember.stations.at(-1).M, 0, 'M at the right knee');
  near(rightColumn.stations[0].M, 0, 'M at the top of the right column');
  near(rightColumn.stations.at(-1).M, 0, 'M at the roller');
});

/* ---------- unavailable cases ---------- */

test('diagrams need a solved problem', () => {
  const { inf } = run({
    members: [{ x1: 0, y1: 0, x2: 6, y2: 0 }],
    supports: [
      { type: 'pin', x: 0, y: 0 },
      { type: 'pin', x: 6, y: 0 },
    ],
  });
  assert.equal(inf.status, 'unavailable');
});

test('diagrams need members', () => {
  const { inf } = run({ supports: [{ type: 'fixed', x: 0, y: 0 }] });
  assert.equal(inf.status, 'unavailable');
  assert.match(inf.message, /member/);
});

test('a load that is not on a member is reported', () => {
  const { inf } = run(beam({ forces: [{ x: 2, y: 1, magnitude: 5, angle: 270 }] }));
  assert.equal(inf.status, 'unavailable');
  assert.match(inf.message, /not on a member/);
});

test('closed loops are reported', () => {
  const { inf } = run({
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
    forces: [{ x: 4, y: 4, magnitude: 5, angle: 270 }],
  });
  assert.equal(inf.status, 'unavailable');
  assert.match(inf.message, /closed loop/);
});

test('disconnected members are reported', () => {
  const { inf } = run({
    members: [
      { x1: 0, y1: 0, x2: 3, y2: 0 },
      { x1: 4, y1: 0, x2: 6, y2: 0 },
    ],
    supports: [
      { type: 'pin', x: 0, y: 0 },
      { type: 'roller', x: 6, y: 0, angle: 90 },
    ],
  });
  assert.equal(inf.status, 'unavailable');
  assert.match(inf.message, /not connected/);
});

/* ---------- drawing ---------- */

test('every diagram renders without invalid numbers', async () => {
  for (const file of ['simply-supported-beam.json', 'beam-udl.json', 'cantilever-udl.json', 'portal-frame.json', 'overhanging-beam.json']) {
    const { problem, solution, inf } = await example(file);
    for (const kind of ['N', 'V', 'M']) {
      const svg = renderDiagram(problem, solution, inf, kind);
      assert.ok(!/NaN|undefined|Infinity/.test(svg), `${file} ${kind}`);
    }
  }
});
