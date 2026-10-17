import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  camera,
  VIEW,
  toScreen,
  toWorld,
  zoomAt,
  panBy,
  fitCamera,
  gridSteps,
  snapStep,
  render,
  MIN_SCALE,
  MAX_SCALE,
} from '../js/draw.js';
import { analyze } from '../js/analysis.js';
import { setUnits } from '../js/units.js';
import { normalizeProblem, emptyProblem } from '../js/model.js';

const near = (actual, expected, label, eps = 1e-6) =>
  assert.ok(Math.abs(actual - expected) < eps, `${label}: expected ${expected}, got ${actual}`);

const examples = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'examples');
const example = async (name) => normalizeProblem(JSON.parse(await readFile(path.join(examples, name), 'utf8')));
const reset = () => {
  Object.assign(camera, { scale: 60, ox: 150, oy: 520 });
  setUnits();
};
const view = (extra = {}) => ({ selectedId: null, pending: null, hover: null, tool: 'select', dims: false, ...extra });

/* ---------- centred default view ---------- */

test('fitting centres the drawing in the free area of the canvas', async () => {
  reset();
  const p = await example('portal-frame.json'); // 6 m wide, 4 m tall
  fitCamera(p, { dims: true });
  // Free area is x 150..870 and y 120..490, so its centre is (510, 305).
  const [cx, cy] = toScreen(3, 2);
  near(cx, 510, 'centre x');
  near(cy, 305, 'centre y');
  // The 4 m height is the limiting dimension: 370 px / 4 m.
  near(camera.scale, 370 / 4, 'scale');
});

test('the whole drawing stays inside the padded area', async () => {
  reset();
  const p = await example('truss-warren.json');
  fitCamera(p, { dims: true });
  const [x0, y0] = toScreen(0, 0);
  const [x1, y1] = toScreen(8, 2);
  assert.ok(x0 >= 150 - 1e-6 && x1 <= VIEW.w - 130 + 1e-6, `x range ${x0}..${x1}`);
  assert.ok(y1 >= 120 - 1e-6 && y0 <= VIEW.h - 130 + 1e-6, `y range ${y1}..${y0}`);
});

test('a horizontal beam is centred and the zoom is capped', async () => {
  reset();
  fitCamera(await example('simply-supported-beam.json'), { dims: true });
  assert.ok(camera.scale <= 100 + 1e-9);
  near((toScreen(0, 0)[0] + toScreen(6, 0)[0]) / 2, 510, 'beam centre x');
});

test('an empty drawing is centred on a typical area', () => {
  reset();
  fitCamera(emptyProblem());
  near(toScreen(5, 3)[0], VIEW.w / 2, 'x');
  near(toScreen(5, 3)[1], VIEW.h / 2, 'y');
  near(camera.scale, 60, 'scale');
});

test('screen and world coordinates convert back and forth', () => {
  reset();
  zoomAt(1.7, 300, 200);
  panBy(-35, 12);
  const [sx, sy] = toScreen(2.5, -1.25);
  const w = toWorld(sx, sy);
  near(w.x, 2.5, 'x');
  near(w.y, -1.25, 'y');
});

/* ---------- zoom and pan ---------- */

test('zooming keeps the point under the cursor in place', () => {
  reset();
  const before = toWorld(400, 300);
  zoomAt(2, 400, 300);
  near(camera.scale, 120, 'scale');
  const [sx, sy] = toScreen(before.x, before.y);
  near(sx, 400, 'x stays');
  near(sy, 300, 'y stays');
});

test('zoom is limited at both ends', () => {
  reset();
  for (let i = 0; i < 50; i++) zoomAt(1.5, 500, 300);
  assert.equal(camera.scale, MAX_SCALE);
  for (let i = 0; i < 100; i++) zoomAt(1 / 1.5, 500, 300);
  assert.equal(camera.scale, MIN_SCALE);
});

test('panning moves everything by the same amount', () => {
  reset();
  const [x, y] = toScreen(3, 1);
  panBy(40, -25);
  const [x2, y2] = toScreen(3, 1);
  near(x2 - x, 40, 'dx');
  near(y2 - y, -25, 'dy');
});

/* ---------- grid and snap follow the zoom and the unit ---------- */

test('grid and snap at the default zoom', () => {
  reset();
  const g = gridSteps();
  assert.equal(g.stepDisp, 1);
  assert.equal(g.snapDisp, 0.5);
  assert.equal(snapStep(), 0.5);
});

test('zooming in makes the grid and snap finer, zooming out coarser', () => {
  reset();
  camera.scale = 100;
  assert.deepEqual([gridSteps().stepDisp, gridSteps().snapDisp], [0.5, 0.1]);
  camera.scale = 30;
  assert.deepEqual([gridSteps().stepDisp, gridSteps().snapDisp], [2, 0.5]);
  camera.scale = 240;
  assert.ok(gridSteps().stepM < 0.5);
});

test('grid lines are always at least 40 px apart', () => {
  reset();
  for (const scale of [9, 15, 22, 37, 60, 83, 140, 260, 480]) {
    camera.scale = scale;
    assert.ok(gridSteps().stepM * scale >= 40 - 1e-6, `scale ${scale}`);
  }
});

test('grid and snap use round numbers of the chosen unit', () => {
  reset();
  setUnits({ length: 'mm', force: 'N' });
  assert.equal(gridSteps().stepDisp, 1000);
  assert.equal(gridSteps().snapDisp, 500);
  near(snapStep(), 0.5, 'snap in metres');

  setUnits({ length: 'ft', force: 'kip' });
  assert.equal(gridSteps().stepDisp, 5);
  assert.equal(gridSteps().snapDisp, 1);
  near(snapStep(), 0.3048, 'one foot in metres');
  reset();
});

/* ---------- dimensions ---------- */

test('dimensions are drawn only when asked for', async () => {
  reset();
  const p = await example('simply-supported-beam.json');
  const s = analyze(p);
  assert.ok(!render(p, s, view({ dims: false })).includes('class="dims"'));
  assert.ok(render(p, s, view({ dims: true })).includes('class="dims"'));
});

test('a beam is dimensioned support to load to support, with an overall length', async () => {
  reset();
  const p = await example('simply-supported-beam.json'); // x = 0, 2, 6
  const svg = render(p, analyze(p), view({ dims: true }));
  const labels = [...svg.matchAll(/class="dim-text"[^>]*>([^<]*)</g)].map((m) => m[1]);
  assert.deepEqual(labels, ['2', '4', '6']);
});

test('a portal gets a row below and a column on the left', async () => {
  reset();
  const p = await example('portal-frame.json'); // x = 0, 6 and y = 0, 4
  const svg = render(p, analyze(p), view({ dims: true }));
  const labels = [...svg.matchAll(/class="dim-text"[^>]*>([^<]*)</g)].map((m) => m[1]);
  assert.deepEqual(labels, ['6', '4']);
  assert.ok(svg.includes('rotate(-90'));
});

test('the dimension column goes on the side without horizontal arrows', async () => {
  reset();
  const verticalLineX = (svg) =>
    [...svg.matchAll(/class="dim-line" x1="([\d.-]+)" y1="([\d.-]+)" x2="([\d.-]+)" y2="([\d.-]+)"/g)]
      .filter((m) => m[1] === m[3])
      .map((m) => Number(m[1]));

  // Portal: the 8 kN load and the Ax reaction both point away from the left edge.
  const portal = await example('portal-frame.json');
  let svg = render(portal, analyze(portal), view({ dims: true }));
  const right = toScreen(6, 0)[0];
  assert.ok(verticalLineX(svg).every((x) => x > right), 'column is to the right of the portal');

  // A beam has only vertical arrows, so the column stays on the left (and a truss too).
  const warren = await example('truss-warren.json');
  svg = render(warren, analyze(warren), view({ dims: true }));
  assert.ok(verticalLineX(svg).every((x) => x < toScreen(0, 0)[0]), 'column is to the left of the truss');
});

test('dimensions follow the chosen unit', async () => {
  reset();
  const p = await example('simply-supported-beam.json');
  setUnits({ length: 'ft', force: 'kip' });
  const svg = render(p, analyze(p), view({ dims: true }));
  const labels = [...svg.matchAll(/class="dim-text"[^>]*>([^<]*)</g)].map((m) => m[1]);
  assert.deepEqual(labels.slice(0, 3), ['6.562', '13.123', '19.685']);
  assert.ok(svg.includes('>ft<'));
  reset();
});

test('a single point has nothing to dimension', () => {
  reset();
  const p = normalizeProblem({ supports: [{ type: 'pin', x: 1, y: 1 }] });
  assert.ok(!render(p, analyze(p), view({ dims: true })).includes('class="dims"'));
});

test('very short segments get a tick but no crowded label', () => {
  reset();
  camera.scale = 15; // 1 m is 15 px: too tight for a label
  const p = normalizeProblem({
    members: [{ x1: 0, y1: 0, x2: 8, y2: 0 }],
    supports: [{ type: 'pin', x: 0, y: 0 }, { type: 'roller', x: 1, y: 0 }],
    forces: [{ x: 8, y: 0, magnitude: 1 }],
  });
  const svg = render(p, analyze(p), view({ dims: true }));
  const labels = [...svg.matchAll(/class="dim-text"[^>]*>([^<]*)</g)].map((m) => m[1]);
  assert.ok(!labels.includes('1'), 'the 1 m segment is too short to label');
  assert.ok(labels.includes('8'), 'the overall length is still labelled');
});

/* ---------- sloped loads ---------- */

test('a triangular load is labelled with both intensities', async () => {
  reset();
  const p = await example('beam-triangular.json');
  const svg = render(p, analyze(p), view());
  assert.ok(svg.includes('0 → 6 kN/m'));
  assert.ok(svg.includes('class="udl-line"'));
});

test('a uniform load keeps a single label', () => {
  reset();
  const p = normalizeProblem({
    members: [{ x1: 0, y1: 0, x2: 6, y2: 0 }],
    supports: [{ type: 'pin', x: 0, y: 0 }, { type: 'roller', x: 6, y: 0 }],
    distributed: [{ x1: 0, y1: 0, x2: 6, y2: 0, w: 5 }],
  });
  const svg = render(p, analyze(p), view());
  assert.ok(svg.includes('5 kN/m') && !svg.includes('→'));
});

test('the arrows get shorter toward the small end of a sloped load', () => {
  reset();
  const p = normalizeProblem({
    distributed: [{ x1: 0, y1: 0, x2: 6, y2: 0, w: 0, w2: 6 }],
  });
  const svg = render(p, analyze(p), view());
  // The envelope runs from the member line (no arrow) up to the full arrow height at the large end.
  const points = svg.match(/class="udl-line" points="([^"]+)"/)[1].split(' ').map((q) => q.split(',').map(Number));
  const first = points[0];
  const last = points.at(-1);
  const [, y0] = toScreen(0, 0);
  near(first[1], y0, 'zero intensity touches the member', 0.01);
  near(y0 - last[1], 40, 'full intensity is 40 px tall', 0.01);
});

test('a negative intensity points the arrows the other way', () => {
  reset();
  const p = normalizeProblem({ distributed: [{ x1: 0, y1: 0, x2: 6, y2: 0, w: -4, w2: -4 }] });
  const svg = render(p, analyze(p), view());
  const points = svg.match(/class="udl-line" points="([^"]+)"/)[1].split(' ').map((q) => q.split(',').map(Number));
  const [, y0] = toScreen(0, 0);
  assert.ok(points[0][1] > y0, 'tails are below the member for an upward load');
});

/* ---------- units in labels ---------- */

test('labels use the chosen units', async () => {
  reset();
  const p = await example('simply-supported-beam.json'); // 12 kN, reactions 8 and 4
  const s = analyze(p);
  setUnits({ length: 'mm', force: 'N' });
  const svg = render(p, s, view());
  assert.ok(svg.includes('12000 N'), 'load');
  assert.ok(svg.includes('Ay = 8000 N'), 'reaction');
  assert.ok(svg.includes('B = 4000 N'), 'reaction');
  reset();
});

test('units never change the numbers the solver finds', async () => {
  reset();
  const p = await example('simply-supported-beam.json');
  const a = analyze(p).unknowns.map((u) => u.value);
  setUnits({ length: 'ft', force: 'lbf' });
  const b = analyze(p).unknowns.map((u) => u.value);
  assert.deepEqual(a, b);
  reset();
});
