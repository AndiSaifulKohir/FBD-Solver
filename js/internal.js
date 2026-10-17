/**
 * Internal forces along members: normal force N, shear (transversal) force V
 * and bending moment M. Pure logic, no DOM.
 *
 * Method of sections. To find the forces at a point on a member, cut the frame
 * there and balance the part on the member's start side. That part carries
 * its loads and reactions, and the cut face must supply the opposite.
 *
 * Each member is read in a fixed direction t: left to right, or bottom to top
 * if it is vertical. This does not depend on the order its joints were drawn,
 * so the signs below never change with how you drew the member. n is t turned
 * 90 degrees counterclockwise (up, for a horizontal member). With F and Mccw
 * the total force and counterclockwise moment (about the cut) of everything on
 * the start side:
 *
 *   N = -(F . t)       tension is positive
 *   V =   F . n        positive shear turns a segment clockwise
 *   M = -Mccw          positive is sagging: tension on the right of t
 *                      (the underside of a horizontal member)
 *
 * Supported frames: one connected tree of members (no closed loops), with every
 * load and support at a joint or on a member.
 */
import { directionOf } from './mathutil.js';
import { buildFrame, TOL } from './frame.js';

const ZERO = 1e-9;
const SAMPLES = 24; // samples per segment between load points

export const DIAGRAM_INFO = {
  N: { title: 'Normal force N', unit: 'kN', note: 'Tension is positive. In a truss, line thickness shows the size of the force.' },
  V: { title: 'Shear force V (transversal)', unit: 'kN', note: 'Positive shear turns a segment clockwise.' },
  M: { title: 'Bending moment M', unit: 'kN·m', note: 'Drawn on the tension side. Positive is sagging (tension on the underside of a horizontal member).' },
};

const tidy = (v) => (Math.abs(v) < ZERO ? 0 : v);

const unavailable = (message) => ({ status: 'unavailable', message, members: [], summary: null });

export function internalForces(problem, solution) {
  if (!solution || solution.status !== 'solved') {
    return unavailable('Solve the reactions first. Internal forces need a stable, determinate set of supports.');
  }

  /* ---------- geometry ---------- */

  const frame = buildFrame(problem);
  if (frame.error) return unavailable(frame.error);
  const { nodes, segments: members, adj } = frame;
  if (members.length === 0) return unavailable('Draw at least one member to see internal force diagrams.');

  const seen = new Set([0]);
  const stack = [0];
  while (stack.length) {
    const u = stack.pop();
    for (const e of adj[u]) {
      if (!seen.has(e.other)) {
        seen.add(e.other);
        stack.push(e.other);
      }
    }
  }
  if (seen.size !== nodes.length) {
    return unavailable('The members are not all connected. Join them at shared joints.');
  }
  if (members.length !== nodes.length - 1) {
    return unavailable('The frame has a closed loop, which needs extra equations. Diagrams are not available yet.');
  }

  /* ---------- attach loads and reactions ---------- */

  const loads = [];
  for (const f of problem.forces) {
    const [dx, dy] = directionOf(f.angle);
    loads.push({ x: f.x, y: f.y, fx: f.magnitude * dx, fy: f.magnitude * dy, c: 0 });
  }
  for (const c of problem.moments) loads.push({ x: c.x, y: c.y, fx: 0, fy: 0, c: c.value });
  for (const r of solution.reactions) loads.push({ x: r.x, y: r.y, fx: r.fx, fy: r.fy, c: r.m });

  const nodeLoads = nodes.map(() => []);
  let stray = 0;
  for (const load of loads) {
    const loc = frame.locate(load.x, load.y);
    if (!loc) stray++;
    else if (loc.node !== undefined) nodeLoads[loc.node].push(load);
    else members[loc.segment].points.push({ s: loc.s, load });
  }
  if (stray) {
    return unavailable(
      stray === 1
        ? 'One load or support is not on a member. Place it on a member or at a joint.'
        : `${stray} loads or supports are not on a member. Place them on a member or at a joint.`
    );
  }

  /* ---------- sections ---------- */

  /** Everything on the start side of member k, as point loads (distributed loads as resultants). */
  const startSideLoads = (k) => {
    const reached = new Set([members[k].a]);
    const usedMembers = new Set();
    const queue = [members[k].a];
    while (queue.length) {
      const u = queue.pop();
      for (const e of adj[u]) {
        if (e.segment === k) continue;
        usedMembers.add(e.segment);
        if (!reached.has(e.other)) {
          reached.add(e.other);
          queue.push(e.other);
        }
      }
    }
    const list = [];
    for (const ni of reached) list.push(...nodeLoads[ni]);
    for (const j of usedMembers) {
      const m = members[j];
      for (const p of m.points) list.push(p.load);
      for (const u of m.udls) {
        const ell = u.hi - u.lo;
        const sc = u.lo + ell / 2;
        list.push({ x: m.x0 + m.t[0] * sc, y: m.y0 + m.t[1] * sc, fx: u.wx * ell, fy: u.wy * ell, c: 0 });
      }
    }
    return list;
  };

  /** N, V, M at distance s along member m. `mid` decides which side of a point load we are on. */
  const evaluate = (m, base, s, mid) => {
    const px = m.x0 + m.t[0] * s;
    const py = m.y0 + m.t[1] * s;
    let fx = 0;
    let fy = 0;
    let moment = 0;
    const add = (x, y, ax, ay, c) => {
      fx += ax;
      fy += ay;
      moment += (x - px) * ay - (y - py) * ax + c;
    };
    for (const l of base) add(l.x, l.y, l.fx, l.fy, l.c);
    for (const p of m.points) if (p.s <= mid) add(p.load.x, p.load.y, p.load.fx, p.load.fy, p.load.c);
    for (const u of m.udls) {
      const ell = Math.min(u.hi, s) - u.lo;
      if (ell > 0) {
        const sc = u.lo + ell / 2;
        add(m.x0 + m.t[0] * sc, m.y0 + m.t[1] * sc, u.wx * ell, u.wy * ell, 0);
      }
    }
    return {
      N: tidy(-(fx * m.t[0] + fy * m.t[1])),
      V: tidy(fx * m.n[0] + fy * m.n[1]),
      M: tidy(-moment),
    };
  };

  const out = members.map((m, k) => {
    const base = startSideLoads(k);
    const breaks = [0, m.length, ...m.points.map((p) => p.s), ...m.udls.flatMap((u) => [u.lo, u.hi])]
      .sort((a, b) => a - b)
      .filter((v, i, arr) => i === 0 || v - arr[i - 1] > TOL);

    const stations = [];
    for (let i = 0; i < breaks.length - 1; i++) {
      const s0 = breaks[i];
      const s1 = breaks[i + 1];
      const mid = (s0 + s1) / 2;
      const positions = [];
      for (let j = 0; j <= SAMPLES; j++) positions.push({ s: s0 + ((s1 - s0) * j) / SAMPLES, edge: j === 0 || j === SAMPLES });

      // V is linear inside a segment, so M peaks exactly where V crosses zero.
      const v0 = evaluate(m, base, s0, mid).V;
      const v1 = evaluate(m, base, s1, mid).V;
      if (v0 * v1 < 0) positions.push({ s: s0 + ((s1 - s0) * v0) / (v0 - v1), edge: false });

      positions.sort((p, q) => p.s - q.s);
      for (const p of positions) stations.push({ s: p.s, edge: p.edge, ...evaluate(m, base, p.s, mid) });
    }
    return { id: m.id, x0: m.x0, y0: m.y0, x1: m.x1, y1: m.y1, length: m.length, t: m.t, n: m.n, stations };
  });

  /* ---------- extremes ---------- */

  const summary = {};
  for (const key of ['N', 'V', 'M']) {
    let max = null;
    let min = null;
    for (const m of out) {
      for (const st of m.stations) {
        const where = { value: st[key], x: m.x0 + m.t[0] * st.s, y: m.y0 + m.t[1] * st.s };
        if (!max || st[key] > max.value + 1e-12) max = where;
        if (!min || st[key] < min.value - 1e-12) min = where;
      }
    }
    summary[key] = { max, min };
  }

  return { status: 'ok', message: '', members: out, summary };
}
