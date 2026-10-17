/**
 * Truss solver by the method of joints. Pure logic, no DOM.
 *
 * Every member is a straight two-force bar, pinned at both ends. Loads and
 * supports sit at joints. Each joint must be in equilibrium:
 *
 *   sum Fx = 0,  sum Fy = 0     (2 equations per joint)
 *
 * Unknowns are the bar forces (tension positive) and the support reactions.
 * A truss is statically determinate when  bars + reactions = 2 x joints.
 *
 * All joints are solved together as one linear system, which also catches
 * mechanisms (too few bars) and indeterminate trusses (too many).
 */
import { directionOf, supportLabel, rref } from './mathutil.js';

const TOL = 1e-4; // geometric tolerance, metres
const EPS = 1e-9;
const tidy = (v) => (Math.abs(v) < EPS ? 0 : v);

export function solveTruss(problem) {
  const base = {
    mode: 'truss',
    loads: { forces: [], moments: [], distributed: [] },
    unknowns: [],
    reactions: [],
    joints: [],
    bars: [],
    system: null,
    check: null,
    degrees: null,
    warning: null,
  };

  /* ---------- geometry ---------- */

  const bars = problem.members.filter((m) => Math.hypot(m.x2 - m.x1, m.y2 - m.y1) > TOL);
  const joints = [];
  const jointAt = (x, y) => {
    let i = joints.findIndex((p) => Math.hypot(p.x - x, p.y - y) < TOL);
    if (i < 0) {
      joints.push({ x, y, label: String(joints.length + 1) });
      i = joints.length - 1;
    }
    return i;
  };
  const barEnds = bars.map((m) => ({ id: m.id, a: jointAt(m.x1, m.y1), b: jointAt(m.x2, m.y2) }));
  const withJoints = { ...base, joints };

  const unsupported = [];
  if (problem.moments.length) unsupported.push('applied moments');
  if (problem.distributed.length) unsupported.push('distributed loads');
  if ((problem.hinges ?? []).length) unsupported.push('hinges');
  if (problem.supports.some((s) => s.type === 'fixed')) unsupported.push('fixed supports');
  if (unsupported.length) {
    return {
      ...withJoints,
      status: 'unsupported',
      message: `A truss uses bars, pin and roller supports, and forces at joints. Remove ${unsupported.join(', ')}, or switch to Frame.`,
    };
  }
  if (problem.members.length === 0) {
    return { ...withJoints, status: 'incomplete', message: 'Draw bars to build a truss.' };
  }
  if (bars.length !== problem.members.length) {
    return {
      ...withJoints,
      status: 'invalid',
      message: 'A bar has zero length. Move its endpoints apart or delete it.',
    };
  }

  const adjacency = joints.map(() => []);
  for (const bar of barEnds) {
    adjacency[bar.a].push(bar.b);
    adjacency[bar.b].push(bar.a);
  }
  const visited = new Set([barEnds[0].a]);
  const stack = [barEnds[0].a];
  while (stack.length) {
    const joint = stack.pop();
    for (const next of adjacency[joint]) {
      if (visited.has(next)) continue;
      visited.add(next);
      stack.push(next);
    }
  }
  if (visited.size !== joints.length) {
    return {
      ...withJoints,
      status: 'invalid',
      message: 'Truss members are not connected. Join every bar at a shared joint.',
    };
  }

  if (problem.supports.length === 0) {
    return { ...withJoints, status: 'incomplete', message: 'Add supports to hold the truss in place.' };
  }

  const jointOf = (x, y) => joints.findIndex((p) => Math.hypot(p.x - x, p.y - y) < TOL);
  const supportJoint = problem.supports.map((s) => jointOf(s.x, s.y));
  const forceJoint = problem.forces.map((f) => jointOf(f.x, f.y));
  const stray = [...supportJoint, ...forceJoint].filter((j) => j < 0).length;
  if (stray) {
    return {
      ...withJoints,
      status: 'unsupported',
      message:
        stray === 1
          ? 'One support or load is not at a joint. In a truss, supports and loads must sit at bar ends.'
          : `${stray} supports or loads are not at a joint. In a truss, supports and loads must sit at bar ends.`,
    };
  }

  /* ---------- unknowns and equations ---------- */

  const m = barEnds.length;
  const reactionUnknowns = [];
  problem.supports.forEach((s, i) => {
    const L = supportLabel(i);
    const j = supportJoint[i];
    if (s.type === 'roller') {
      const angle = Number.isFinite(s.angle) ? s.angle : 90;
      const [c, sn] = directionOf(angle);
      reactionUnknowns.push({ support: s.id, joint: j, label: L, kind: 'R', angle, dir: [c, sn], force: [c, sn], value: null });
    } else {
      reactionUnknowns.push({ support: s.id, joint: j, label: `${L}x`, kind: 'Rx', force: [1, 0], value: null });
      reactionUnknowns.push({ support: s.id, joint: j, label: `${L}y`, kind: 'Ry', force: [0, 1], value: null });
    }
  });

  const r = reactionUnknowns.length;
  const n = m + r;
  const nJoints = joints.length;
  const A = Array.from({ length: 2 * nJoints }, () => new Array(n + 1).fill(0));

  const lengths = barEnds.map((bar) => {
    const a = joints[bar.a];
    const b = joints[bar.b];
    return Math.hypot(b.x - a.x, b.y - a.y);
  });

  barEnds.forEach((bar, k) => {
    const a = joints[bar.a];
    const b = joints[bar.b];
    const ux = (b.x - a.x) / lengths[k];
    const uy = (b.y - a.y) / lengths[k];
    // A bar in tension pulls each end joint toward the other end.
    A[2 * bar.a][k] += ux;
    A[2 * bar.a + 1][k] += uy;
    A[2 * bar.b][k] -= ux;
    A[2 * bar.b + 1][k] -= uy;
  });
  reactionUnknowns.forEach((u, i) => {
    A[2 * u.joint][m + i] += u.force[0];
    A[2 * u.joint + 1][m + i] += u.force[1];
  });

  const loads = problem.forces.map((f, i) => {
    const [dx, dy] = directionOf(f.angle);
    return { id: f.id, label: `P${i + 1}`, kind: 'force', x: f.x, y: f.y, fx: f.magnitude * dx, fy: f.magnitude * dy, joint: forceJoint[i] };
  });
  for (const f of loads) {
    A[2 * f.joint][n] -= f.fx;
    A[2 * f.joint + 1][n] -= f.fy;
  }

  const original = A.map((row) => [...row]);
  const scale = Math.max(1, ...A.flat().map(Math.abs));
  const tol = EPS * scale;
  const { pivots, rank } = rref(A, n, tol);
  const degrees = { bars: m, reactions: r, joints: nJoints, unknowns: n, equations: 2 * nJoints };
  const common = { ...withJoints, loads: { forces: loads, moments: [], distributed: [] }, degrees };

  if (A.slice(rank).some((row) => Math.abs(row[n]) > tol)) {
    return {
      ...common,
      status: 'unstable',
      message: 'The truss cannot balance these loads, so it would move. It may be a mechanism: add a bar or change a support.',
    };
  }

  if (rank < n) {
    if (n > 2 * nJoints) {
      const degree = n - 2 * nJoints;
      return {
        ...common,
        status: 'indeterminate',
        message: `Statically indeterminate to degree ${degree}: ${m} bars + ${r} reactions exceed 2 × ${nJoints} joints. Remove ${degree} bar${degree > 1 ? 's' : ''} or reaction${degree > 1 ? 's' : ''}.`,
      };
    }
    return {
      ...common,
      status: 'unstable',
      message: 'The bars and supports do not form a stable truss: there is a mechanism or a redundant part. Add a bar or move a support.',
    };
  }

  /* ---------- solution ---------- */

  const x = new Array(n).fill(0);
  pivots.forEach((col, i) => {
    x[col] = tidy(A[i][n]);
  });

  const solvedBars = barEnds.map((bar, k) => {
    const force = x[k];
    return {
      id: bar.id,
      label: `B${k + 1}`,
      a: bar.a,
      b: bar.b,
      length: lengths[k],
      force,
      state: force === 0 ? 'zero' : force > 0 ? 'tension' : 'compression',
    };
  });

  reactionUnknowns.forEach((u, i) => {
    u.value = x[m + i];
  });

  const reactions = problem.supports.map((s, i) => {
    let fx = 0;
    let fy = 0;
    for (const u of reactionUnknowns.filter((k) => k.support === s.id)) {
      if (u.kind === 'Rx') fx = u.value;
      else if (u.kind === 'Ry') fy = u.value;
      else {
        fx = u.value * u.dir[0];
        fy = u.value * u.dir[1];
      }
    }
    return { id: s.id, label: supportLabel(i), type: s.type, x: s.x, y: s.y, fx, fy, m: 0 };
  });

  return {
    ...common,
    status: 'solved',
    message:
      m + r === 2 * nJoints
        ? `Statically determinate: ${m} bars + ${r} reactions = 2 × ${nJoints} joints.`
        : 'The truss is in equilibrium for this loading.',
    warning:
      m + r < 2 * nJoints
        ? `There are fewer bars and reactions (${m + r}) than joint equations (${2 * nJoints}), so this is a mechanism that is balanced only under this particular loading.`
        : null,
    unknowns: reactionUnknowns,
    reactions,
    bars: solvedBars,
    check: verify(original, x, n, loads, reactions, scale),
  };
}

/** Independent check: every joint balances, and so does the truss as a whole. */
function verify(original, x, n, loads, reactions, scale) {
  let worstJoint = 0;
  for (const row of original) {
    let sum = -row[n];
    for (let j = 0; j < n; j++) sum += row[j] * x[j];
    worstJoint = Math.max(worstJoint, Math.abs(sum));
  }

  const sumFx = loads.reduce((a, f) => a + f.fx, 0) + reactions.reduce((a, q) => a + q.fx, 0);
  const sumFy = loads.reduce((a, f) => a + f.fy, 0) + reactions.reduce((a, q) => a + q.fy, 0);
  const about = (px, py) =>
    loads.reduce((a, f) => a + (f.x - px) * f.fy - (f.y - py) * f.fx, 0) +
    reactions.reduce((a, q) => a + (q.x - px) * q.fy - (q.y - py) * q.fx, 0);
  const last = reactions[reactions.length - 1];
  const moments = [
    { about: { x: 0, y: 0 }, value: about(0, 0) },
    { about: { x: last.x, y: last.y }, value: about(last.x, last.y) },
  ];

  const limit = 1e-6 * scale;
  const ok = worstJoint <= limit && [sumFx, sumFy, ...moments.map((q) => q.value)].every((v) => Math.abs(v) <= limit);
  return { fx: sumFx, fy: sumFy, moments, worstJoint, ok };
}

/**
 * Normal-force diagram data for a solved truss, in the same shape the frame
 * diagrams use. Each bar carries one constant axial force (tension positive).
 */
export function trussAxial(problem, solution) {
  if (!solution || solution.status !== 'solved') {
    return {
      status: 'unavailable',
      message: 'Solve the truss first. Normal forces need a stable, determinate truss.',
      members: [],
      summary: null,
    };
  }
  const members = solution.bars.map((b) => {
    const a = solution.joints[b.a];
    const c = solution.joints[b.b];
    const t = [(c.x - a.x) / b.length, (c.y - a.y) / b.length];
    const station = (s, edge) => ({ s, edge, N: b.force, V: 0, M: 0 });
    return {
      id: b.id,
      x0: a.x,
      y0: a.y,
      x1: c.x,
      y1: c.y,
      length: b.length,
      t,
      n: [-t[1], t[0]],
      constant: true,
      stations: [station(0, false), station(b.length / 2, true), station(b.length, false)],
    };
  });
  const forces = solution.bars.map((b) => b.force);
  const where = (b) => {
    const a = solution.joints[b.a];
    const c = solution.joints[b.b];
    return { value: b.force, x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };
  };
  const maxBar = solution.bars.find((b) => b.force === Math.max(...forces));
  const minBar = solution.bars.find((b) => b.force === Math.min(...forces));
  return { status: 'ok', message: '', members, summary: { N: { max: where(maxBar), min: where(minBar) } } };
}
