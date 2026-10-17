/**
 * Problem data model. A problem is plain JSON:
 *
 * {
 *   "name": "Simply supported beam",
 *   "mode": "frame" | "truss",
 *   "members":     [{ "id", "x1", "y1", "x2", "y2" }],
 *   "supports":    [{ "id", "type": "pin" | "roller" | "fixed", "x", "y", "angle"? }],
 *   "forces":      [{ "id", "x", "y", "magnitude", "angle" }],
 *   "moments":     [{ "id", "x", "y", "value" }],
 *   "distributed": [{ "id", "x1", "y1", "x2", "y2", "w", "angle" }],
 *   "hinges":      [{ "id", "x", "y" }]
 * }
 *
 * In frame mode the whole structure is one rigid body, joined by rigid joints
 * except at hinges. In truss mode every member is a pin-jointed bar.
 */

export const KINDS = {
  member: 'members',
  support: 'supports',
  force: 'forces',
  moment: 'moments',
  udl: 'distributed',
  hinge: 'hinges',
};

export const SUPPORT_TYPES = ['pin', 'roller', 'fixed'];

let seq = 0;
export function uid(prefix = 'i') {
  seq += 1;
  return `${prefix}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export const MODES = ['frame', 'truss'];

export function emptyProblem(name = 'Untitled problem', mode = 'frame') {
  return { name, mode, members: [], supports: [], forces: [], moments: [], distributed: [], hinges: [] };
}

/** Which keys hold the draggable points of each item kind. */
export function pointKeys(kind) {
  return kind === 'member' || kind === 'udl'
    ? [['x1', 'y1'], ['x2', 'y2']]
    : [['x', 'y']];
}

export function findItem(problem, id) {
  for (const [kind, key] of Object.entries(KINDS)) {
    const item = problem[key].find((i) => i.id === id);
    if (item) return { kind, item };
  }
  return null;
}

export function removeItem(problem, id) {
  for (const key of Object.values(KINDS)) {
    const index = problem[key].findIndex((i) => i.id === id);
    if (index >= 0) {
      problem[key].splice(index, 1);
      return true;
    }
  }
  return false;
}

/** Validate raw JSON and return a complete problem. Throws Error with a readable message. */
export function normalizeProblem(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('A problem file must contain a JSON object.');
  }

  const mode = raw.mode ?? 'frame';
  if (!MODES.includes(mode)) throw new Error(`mode must be one of: ${MODES.join(', ')}.`);
  const problem = emptyProblem(
    typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'Untitled problem',
    mode
  );
  const seen = new Set();

  const idFor = (item, prefix) => {
    const id = typeof item.id === 'string' && item.id && !seen.has(item.id) ? item.id : uid(prefix);
    seen.add(id);
    return id;
  };

  const num = (value, where, fallback) => {
    if (value === undefined && fallback !== undefined) return fallback;
    const n = typeof value === 'string' && value.trim() === '' ? NaN : Number(value);
    if (value === null || !Number.isFinite(n)) throw new Error(`${where} must be a number.`);
    return n;
  };

  const list = (key) => {
    const value = raw[key] ?? [];
    if (!Array.isArray(value)) throw new Error(`"${key}" must be a list.`);
    value.forEach((item, i) => {
      if (!item || typeof item !== 'object') throw new Error(`${key}[${i}] must be an object.`);
    });
    return value;
  };

  list('members').forEach((m, i) => {
    const at = `members[${i}]`;
    problem.members.push({
      id: idFor(m, 'm'),
      x1: num(m.x1, `${at}.x1`),
      y1: num(m.y1, `${at}.y1`),
      x2: num(m.x2, `${at}.x2`),
      y2: num(m.y2, `${at}.y2`),
    });
  });

  list('supports').forEach((s, i) => {
    const at = `supports[${i}]`;
    if (!SUPPORT_TYPES.includes(s.type)) {
      throw new Error(`${at}.type must be one of: ${SUPPORT_TYPES.join(', ')}.`);
    }
    const support = {
      id: idFor(s, 's'),
      type: s.type,
      x: num(s.x, `${at}.x`),
      y: num(s.y, `${at}.y`),
    };
    if (s.type === 'roller') support.angle = num(s.angle, `${at}.angle`, 90);
    problem.supports.push(support);
  });

  list('forces').forEach((f, i) => {
    const at = `forces[${i}]`;
    problem.forces.push({
      id: idFor(f, 'f'),
      x: num(f.x, `${at}.x`),
      y: num(f.y, `${at}.y`),
      magnitude: num(f.magnitude, `${at}.magnitude`),
      angle: num(f.angle, `${at}.angle`, 270),
    });
  });

  list('moments').forEach((c, i) => {
    const at = `moments[${i}]`;
    problem.moments.push({
      id: idFor(c, 'c'),
      x: num(c.x, `${at}.x`),
      y: num(c.y, `${at}.y`),
      value: num(c.value, `${at}.value`),
    });
  });

  list('distributed').forEach((d, i) => {
    const at = `distributed[${i}]`;
    problem.distributed.push({
      id: idFor(d, 'w'),
      x1: num(d.x1, `${at}.x1`),
      y1: num(d.y1, `${at}.y1`),
      x2: num(d.x2, `${at}.x2`),
      y2: num(d.y2, `${at}.y2`),
      w: num(d.w, `${at}.w`),
      angle: num(d.angle, `${at}.angle`, 270),
    });
  });

  list('hinges').forEach((h, i) => {
    const at = `hinges[${i}]`;
    problem.hinges.push({
      id: idFor(h, 'h'),
      x: num(h.x, `${at}.x`),
      y: num(h.y, `${at}.y`),
    });
  });

  return problem;
}
