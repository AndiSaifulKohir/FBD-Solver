import test from 'node:test';
import assert from 'node:assert/strict';

import { setUnits, getUnits, toDisplay, fromDisplay, unitLabel, LENGTH_UNITS, FORCE_UNITS } from '../js/units.js';
import { normalizeProblem, emptyProblem } from '../js/model.js';

const near = (actual, expected, label, eps = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < eps, `${label}: expected ${expected}, got ${actual}`);

test('metres and kilonewtons are the default and change nothing', () => {
  setUnits();
  assert.deepEqual(getUnits(), { length: 'm', force: 'kN' });
  assert.equal(toDisplay('length', 2.5), 2.5);
  assert.equal(toDisplay('force', 12), 12);
  assert.equal(unitLabel('dist'), 'kN/m');
  assert.equal(unitLabel('moment'), 'kN·m');
});

test('millimetres and newtons', () => {
  setUnits({ length: 'mm', force: 'N' });
  near(toDisplay('length', 2), 2000, 'length');
  near(toDisplay('force', 12), 12000, 'force');
  near(toDisplay('dist', 5), 5, 'a kN/m is the same number as N/mm');
  near(toDisplay('moment', 3), 3e6, 'kN·m to N·mm');
  assert.equal(unitLabel('dist'), 'N/mm');
  assert.equal(unitLabel('moment'), 'N·mm');
  setUnits();
});

test('feet and kips', () => {
  setUnits({ length: 'ft', force: 'kip' });
  near(fromDisplay('length', 10), 3.048, 'ten feet in metres');
  near(toDisplay('force', FORCE_UNITS.kip), 1, 'one kip');
  near(fromDisplay('dist', 1), FORCE_UNITS.kip / LENGTH_UNITS.ft, '1 kip/ft in kN/m');
  assert.equal(unitLabel('dist'), 'kip/ft');
  assert.equal(unitLabel('moment'), 'kip·ft');
  setUnits();
});

test('converting to display and back returns the stored value', () => {
  for (const length of Object.keys(LENGTH_UNITS)) {
    for (const force of Object.keys(FORCE_UNITS)) {
      setUnits({ length, force });
      for (const type of ['length', 'force', 'dist', 'moment']) {
        near(fromDisplay(type, toDisplay(type, 7.25)), 7.25, `${length} ${force} ${type}`);
      }
    }
  }
  setUnits();
});

test('angles are never converted', () => {
  setUnits({ length: 'ft', force: 'lbf' });
  assert.equal(toDisplay('angle', 270), 270);
  assert.equal(unitLabel('angle'), '°');
  setUnits();
});

test('unknown unit names fall back to the defaults', () => {
  setUnits({ length: 'furlong', force: 'toString' });
  assert.deepEqual(getUnits(), { length: 'm', force: 'kN' });
});

test('problems store units and reject unknown ones', () => {
  assert.deepEqual(emptyProblem().units, { length: 'm', force: 'kN' });
  assert.deepEqual(normalizeProblem({ units: { length: 'ft' } }).units, { length: 'ft', force: 'kN' });
  assert.throws(() => normalizeProblem({ units: { length: 'yard' } }), /units\.length must be one of/);
  assert.throws(() => normalizeProblem({ units: { force: 'dyne' } }), /units\.force must be one of/);
});

test('stored values never depend on the display units', () => {
  const raw = { members: [{ x1: 0, y1: 0, x2: 6, y2: 0 }], forces: [{ x: 3, y: 0, magnitude: 12 }] };
  const a = normalizeProblem(raw);
  const b = normalizeProblem({ ...raw, units: { length: 'ft', force: 'lbf' } });
  const coords = (p) => p.members.map(({ x1, y1, x2, y2 }) => [x1, y1, x2, y2]);
  assert.deepEqual(coords(a), coords(b));
  assert.deepEqual(a.forces.map((f) => f.magnitude), b.forces.map((f) => f.magnitude));
});
