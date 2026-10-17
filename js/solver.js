/**
 * 2D rigid-body equilibrium solver for beams and frames.
 *
 * Pure logic: no DOM, no rounding. Rounding happens only when displaying.
 *
 * Conventions
 *   Units:      kN, m, degrees
 *   Axes:       +x right, +y up
 *   Angles:     counterclockwise from +x (270 degrees points down)
 *   Moments:    counterclockwise is positive
 *
 * The whole frame is one body in equilibrium:
 *   sum Fx = 0,  sum Fy = 0,  sum M = 0
 *
 * Each internal hinge adds equations. A hinge carries no moment, so the
 * moment of everything on one side of it, taken about the hinge, is zero.
 * A hinge where k members meet gives k - 1 independent equations.
 *
 * Each support contributes unknown reactions:
 *   pin    -> Rx, Ry
 *   roller -> one force along its direction (default 90 degrees, i.e. up)
 *   fixed  -> Rx, Ry and a reaction moment
 */
import { clean, directionOf, supportLabel, momentAbout, rref, loadParts, portionParts } from './mathutil.js';
import { buildFrame, inBranch } from './frame.js';

export { clean, directionOf, supportLabel };

const EPS = 1e-9;
const tidy = (v) => (Math.abs(v) < EPS ? 0 : v);

/**
 * Reduce all applied loads to point forces and couples.
 * A distributed load becomes one resultant (intensity x length) at its midpoint.
 */
export function resolveLoads(problem) {
  const forces = [];
  const moments = [];
  const distributed = [];

  problem.forces.forEach((f, i) => {
    const [dx, dy] = directionOf(f.angle);
    forces.push({
      id: f.id,
      label: `P${i + 1}`,
      kind: 'force',
      x: f.x,
      y: f.y,
      fx: f.magnitude * dx,
      fy: f.magnitude * dy,
    });
  });

  problem.distributed.forEach((d, i) => {
    const [dx, dy] = directionOf(d.angle);
    const w1 = d.w;
    const w2 = d.w2 ?? d.w;
    const len = Math.hypot(d.x2 - d.x1, d.y2 - d.y1);
    const ux = len > 0 ? (d.x2 - d.x1) / len : 0;
    const uy = len > 0 ? (d.y2 - d.y1) / len : 0;
    const label = `W${i + 1}`;

    // A load that varies linearly acts as a uniform part plus a triangular part.
    for (const part of loadParts(w1, w2, len)) {
      if (part.force === 0) continue;
      forces.push({
        id: d.id,
        label,
        kind: 'distributed',
        part: true,
        x: d.x1 + ux * part.at,
        y: d.y1 + uy * part.at,
        fx: part.force * dx,
        fy: part.force * dy,
      });
    }

    // Single resultant for display: total force and where it acts.
    const total = ((w1 + w2) / 2) * len;
    const sum = w1 + w2;
    const at = Math.abs(sum) > 1e-12 ? (len * (w1 + 2 * w2)) / (3 * sum) : len / 2;
    distributed.push({ id: d.id, label, total, w1, w2, x: d.x1 + ux * at, y: d.y1 + uy * at });
  });

  problem.moments.forEach((m, i) => {
    moments.push({ id: m.id, label: `C${i + 1}`, value: m.value });
  });

  return { forces, moments, distributed };
}

/**
 * One unknown per reaction component. `force` is its direction and
 * `moment(px, py)` is its moment about any point.
 */
function buildUnknowns(supports) {
  const unknowns = [];
  supports.forEach((s, i) => {
    const L = supportLabel(i);
    if (s.type === 'roller') {
      const angle = Number.isFinite(s.angle) ? s.angle : 90;
      const [c, sn] = directionOf(angle);
      unknowns.push({
        support: s.id,
        label: L,
        kind: 'R',
        angle,
        dir: [c, sn],
        force: [c, sn],
        moment: (px, py) => (s.x - px) * sn - (s.y - py) * c,
        value: null,
      });
      return;
    }
    unknowns.push({ support: s.id, label: `${L}x`, kind: 'Rx', force: [1, 0], moment: (px, py) => -(s.y - py), value: null });
    unknowns.push({ support: s.id, label: `${L}y`, kind: 'Ry', force: [0, 1], moment: (px) => s.x - px, value: null });
    if (s.type === 'fixed') {
      unknowns.push({ support: s.id, label: `M${L}`, kind: 'M', force: [0, 0], moment: () => 1, value: null });
    }
  });
  return unknowns;
}

/**
 * Extra equations from internal hinges. Returns { rows } or { error }.
 * Each row is "moment about the hinge of one branch = 0".
 */
function hingeEquations(problem, supports, unknowns, frame) {
  const hinges = problem.hinges ?? [];
  if (hinges.length === 0) return { rows: [] };

  const supportLoc = new Map();
  for (const s of supports) {
    const loc = frame.locate(s.x, s.y);
    if (!loc) return { error: 'A support is not on a member. Place it on a member or joint.' };
    supportLoc.set(s.id, loc);
  }
  const forceLoc = [];
  for (const f of problem.forces) {
    const loc = frame.locate(f.x, f.y);
    if (!loc) return { error: 'A point force is not on a member. Place it on a member or joint.' };
    forceLoc.push(loc);
  }
  const momentLoc = [];
  for (const c of problem.moments) {
    const loc = frame.locate(c.x, c.y);
    if (!loc) return { error: 'An applied moment is not on a member. Place it on a member or joint.' };
    momentLoc.push(loc);
  }

  const rows = [];
  for (let hi = 0; hi < hinges.length; hi++) {
    const h = hinges[hi];
    const node = frame.nodeIndex(h.x, h.y);
    const found = frame.branches(node);
    if (found.error) return { error: found.error };
    const { branches } = found;
    if (branches.length < 2) continue; // a hinge at a free end releases nothing

    if (momentLoc.some((loc) => loc.node === node)) {
      return { error: 'An applied moment cannot be placed at a hinge.' };
    }
    for (const u of unknowns) {
      if (u.kind === 'M' && supportLoc.get(u.support).node === node) {
        return { error: 'A fixed support cannot be placed at a hinge.' };
      }
    }

    // One equation per branch except the last: that one follows from overall equilibrium.
    for (let bi = 0; bi < branches.length - 1; bi++) {
      const br = branches[bi];
      let known = 0;

      problem.forces.forEach((f, i) => {
        if (!inBranch(br, forceLoc[i])) return;
        const [dx, dy] = directionOf(f.angle);
        known += momentAbout(h.x, h.y, f.x, f.y, f.magnitude * dx, f.magnitude * dy);
      });
      problem.moments.forEach((c, i) => {
        if (inBranch(br, momentLoc[i])) known += c.value;
      });
      for (const si of br.segs) {
        const sg = frame.segments[si];
        for (const u of sg.udls) {
          for (const p of portionParts(u)) {
            known += momentAbout(h.x, h.y, sg.x0 + sg.t[0] * p.s, sg.y0 + sg.t[1] * p.s, p.fx, p.fy);
          }
        }
      }

      rows.push({
        name: `ΣM(H${hi + 1}, ${br.side})`,
        coeffs: unknowns.map((u) => (inBranch(br, supportLoc.get(u.support)) ? u.moment(h.x, h.y) : 0)),
        known,
      });
    }
  }
  return { rows };
}

/**
 * Solve for support reactions.
 *
 * status:
 *   'incomplete'    no supports yet
 *   'invalid'       member geometry or item attachment is invalid
 *   'unstable'      loads cannot be balanced, or reactions are not independent
 *   'indeterminate' more unknown reactions than equilibrium equations
 *   'solved'        unique solution found (see `warning` for partial restraint)
 */
export function solve(problem) {
  const loads = resolveLoads(problem);
  const { supports } = problem;
  const base = {
    loads,
    unknowns: [],
    reactions: [],
    system: null,
    check: null,
    degrees: null,
    warning: null,
  };

  const frame = buildFrame(problem);
  if (frame.error) return { ...base, status: 'invalid', message: frame.error };

  if (supports.length === 0) {
    return { ...base, status: 'incomplete', message: 'Add at least one support to hold the body in place.' };
  }

  // Take moments about the first support so its reactions drop out of the moment equation.
  const origin = { x: supports[0].x, y: supports[0].y };
  const unknowns = buildUnknowns(supports);
  const n = unknowns.length;

  const known = [0, 0, 0];
  for (const f of loads.forces) {
    known[0] += f.fx;
    known[1] += f.fy;
    known[2] += momentAbout(origin.x, origin.y, f.x, f.y, f.fx, f.fy);
  }
  for (const m of loads.moments) known[2] += m.value;

  const hinge = hingeEquations(problem, supports, unknowns, frame);
  if (hinge.error) return { ...base, status: 'invalid', message: hinge.error };

  const rows = [
    ...['ΣFx', 'ΣFy', `ΣM${supportLabel(0)}`].map((name, r) => ({
      name,
      coeffs: unknowns.map((u) => (r === 2 ? u.moment(origin.x, origin.y) : u.force[r])),
      known: known[r],
    })),
    ...hinge.rows,
  ];
  const equations = rows.length;
  const system = { origin, labels: unknowns.map((u) => u.label), rows };

  // Unknown-coefficient matrix with the known loads moved to the right-hand side.
  const aug = rows.map((row) => [...row.coeffs, -row.known]);
  const scale = Math.max(1, ...aug.flat().map(Math.abs));
  const tol = EPS * scale;
  const { pivots, rank } = rref(aug, n, tol);
  const degrees = { unknowns: n, equations };
  const common = { ...base, unknowns, system, degrees };

  const inconsistent = aug.slice(rank).some((row) => Math.abs(row[n]) > tol);
  if (inconsistent) {
    return {
      ...common,
      status: 'unstable',
      message: 'The supports cannot balance these loads, so the body would move. Add a support or change a support type.',
    };
  }

  if (rank < n) {
    if (n > equations) {
      const extra = n - equations;
      return {
        ...common,
        status: 'indeterminate',
        message: `Statically indeterminate: ${n} unknown reactions but only ${equations} equilibrium equations. Remove ${extra} reaction${extra > 1 ? 's' : ''} (for example, change a pin to a roller) or add a hinge.`,
      };
    }
    return {
      ...common,
      status: 'unstable',
      message: 'The reactions are not independent, for example parallel roller directions or lines of action that meet at one point. Move or change a support.',
    };
  }

  pivots.forEach((col, i) => {
    unknowns[col].value = tidy(aug[i][n]);
  });

  const reactions = supports.map((s, i) => {
    let fx = 0;
    let fy = 0;
    let m = 0;
    for (const u of unknowns.filter((k) => k.support === s.id)) {
      if (u.kind === 'Rx') fx = u.value;
      else if (u.kind === 'Ry') fy = u.value;
      else if (u.kind === 'M') m = u.value;
      else {
        fx = u.value * u.dir[0];
        fy = u.value * u.dir[1];
      }
    }
    return { id: s.id, label: supportLabel(i), type: s.type, x: s.x, y: s.y, fx, fy, m };
  });

  return {
    ...common,
    status: 'solved',
    message:
      n === equations
        ? `Statically determinate: ${n} unknowns, ${equations} equations. The body is in equilibrium.`
        : 'The body is in equilibrium for this loading.',
    warning:
      n < equations
        ? `There are only ${n} unknown reactions for ${equations} equilibrium equations, so the structure can move and is balanced only under this particular loading.`
        : null,
    reactions,
    check: verify(loads, reactions, scale),
  };
}

/**
 * Independent check: add up loads and reactions and confirm the net force
 * and the net moment about two different points are all zero.
 */
function verify(loads, reactions, scale) {
  const sumFx = loads.forces.reduce((a, f) => a + f.fx, 0) + reactions.reduce((a, r) => a + r.fx, 0);
  const sumFy = loads.forces.reduce((a, f) => a + f.fy, 0) + reactions.reduce((a, r) => a + r.fy, 0);
  const last = reactions[reactions.length - 1];
  const points = [{ x: 0, y: 0 }, { x: last.x, y: last.y }];

  const moments = points.map((p) => {
    let value = 0;
    for (const f of loads.forces) value += momentAbout(p.x, p.y, f.x, f.y, f.fx, f.fy);
    for (const m of loads.moments) value += m.value;
    for (const r of reactions) value += momentAbout(p.x, p.y, r.x, r.y, r.fx, r.fy) + r.m;
    return { about: p, value };
  });

  const limit = 1e-6 * scale;
  const ok = [sumFx, sumFy, ...moments.map((m) => m.value)].every((v) => Math.abs(v) <= limit);
  return { fx: sumFx, fy: sumFy, moments, ok };
}
