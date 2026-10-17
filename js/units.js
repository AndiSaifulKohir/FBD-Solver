/**
 * Display units. Pure logic, no DOM.
 *
 * Everything stored in a problem, and everything the solver computes, is in
 * metres and kilonewtons. Units only change how values are shown and typed.
 * Moments are force x length, and distributed loads are force / length, so
 * both follow the chosen force and length units.
 *
 * Each factor is the size of one display unit in metres or kilonewtons.
 */
export const LENGTH_UNITS = { m: 1, cm: 0.01, mm: 0.001, ft: 0.3048, in: 0.0254 };
export const FORCE_UNITS = { kN: 1, N: 0.001, kip: 4.4482216152605, lbf: 0.0044482216152605 };
export const DEFAULT_UNITS = { length: 'm', force: 'kN' };

const has = (table, key) => Object.hasOwn(table, key);

let current = { ...DEFAULT_UNITS };

/** Choose the display units. Unknown names fall back to metres and kilonewtons. */
export function setUnits(units = {}) {
  current = {
    length: has(LENGTH_UNITS, units.length) ? units.length : DEFAULT_UNITS.length,
    force: has(FORCE_UNITS, units.force) ? units.force : DEFAULT_UNITS.force,
  };
}

export function getUnits() {
  return { ...current };
}

/** Size of one display unit of this kind, in metres / kilonewtons. */
function factor(type) {
  const L = LENGTH_UNITS[current.length];
  const F = FORCE_UNITS[current.force];
  switch (type) {
    case 'length':
      return L;
    case 'force':
      return F;
    case 'dist':
      return F / L;
    case 'moment':
      return F * L;
    default:
      return 1; // angle
  }
}

/** Stored value (m, kN) -> displayed value. type: length | force | dist | moment | angle */
export const toDisplay = (type, value) => value / factor(type);

/** Typed value -> stored value (m, kN). */
export const fromDisplay = (type, value) => value * factor(type);

export function unitLabel(type) {
  switch (type) {
    case 'length':
      return current.length;
    case 'force':
      return current.force;
    case 'dist':
      return `${current.force}/${current.length}`;
    case 'moment':
      return `${current.force}·${current.length}`;
    default:
      return '°';
  }
}
