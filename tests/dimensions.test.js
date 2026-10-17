import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { definedPoints, uniqueSorted, dimensionChains, boundsOf } from '../js/dimensions.js';
import { normalizeProblem, emptyProblem } from '../js/model.js';

const examples = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'examples');
const example = async (name) => normalizeProblem(JSON.parse(await readFile(path.join(examples, name), 'utf8')));

test('simply supported beam: dimensions run between the supports and the load', async () => {
  const { xs, ys } = dimensionChains(await example('simply-supported-beam.json'));
  assert.deepEqual(xs, [0, 2, 6]);
  assert.deepEqual(ys, [0]);
});

test('every kind of item contributes positions', () => {
  const p = normalizeProblem({
    members: [{ x1: 0, y1: 0, x2: 8, y2: 0 }],
    supports: [{ type: 'pin', x: 1, y: 0 }],
    forces: [{ x: 2, y: 0, magnitude: 1 }],
    moments: [{ x: 3, y: 0, value: 1 }],
    hinges: [{ x: 4, y: 0 }],
    distributed: [{ x1: 5, y1: 0, x2: 7, y2: 0, w: 1 }],
  });
  assert.deepEqual(dimensionChains(p).xs, [0, 1, 2, 3, 4, 5, 7, 8]);
  const kinds = new Set(definedPoints(p).map((q) => q.kind));
  assert.deepEqual([...kinds].sort(), ['distributed', 'force', 'hinge', 'member', 'moment', 'support']);
});

test('a portal has two distinct x positions and two distinct y positions', async () => {
  const { xs, ys } = dimensionChains(await example('portal-frame.json'));
  assert.deepEqual(xs, [0, 6]);
  assert.deepEqual(ys, [0, 4]);
});

test('the Warren truss is dimensioned joint to joint', async () => {
  const { xs, ys } = dimensionChains(await example('truss-warren.json'));
  assert.deepEqual(xs, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(ys, [0, 2]);
});

test('positions that coincide are merged', () => {
  assert.deepEqual(uniqueSorted([3, 0, 3 + 1e-9, 5, 0]), [0, 3, 5]);
  assert.deepEqual(uniqueSorted([]), []);
});

test('bounds of the drawing', async () => {
  assert.deepEqual(boundsOf(await example('portal-frame.json')), { minX: 0, maxX: 6, minY: 0, maxY: 4 });
  assert.equal(boundsOf(emptyProblem()), null);
});
