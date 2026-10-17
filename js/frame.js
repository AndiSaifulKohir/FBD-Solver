/**
 * Frame geometry: turns drawn members into a graph of joints and segments.
 *
 * - Joints are member ends and hinges.
 * - A member is split into segments wherever a joint touches its interior
 *   (a hinge in the middle of a beam, or another member meeting it in a T).
 * - Every segment is read in a fixed direction: left to right, or bottom to
 *   top if vertical. Internal-force signs depend on this, not on how you drew.
 *
 * Pure logic, no DOM.
 */
import { directionOf } from './mathutil.js';

export const TOL = 1e-4; // geometric tolerance, metres

const LOOP = 'A hinge inside a closed loop is not supported yet.';

/**
 * Returns { error } if the geometry is unusable, otherwise
 * { nodes, segments, adj, nodeIndex, locate, branches }.
 */
export function buildFrame(problem) {
  if (problem.members.length === 0) return { error: 'Draw at least one member before solving.' };
  if (problem.members.some((m) => Math.hypot(m.x2 - m.x1, m.y2 - m.y1) <= TOL)) {
    return { error: 'A member has zero length. Move its endpoints apart or delete it.' };
  }
  const raw = problem.members;

  const nodes = [];
  const nodeIndex = (x, y) => nodes.findIndex((p) => Math.hypot(p.x - x, p.y - y) < TOL);
  const nodeAt = (x, y) => {
    let i = nodeIndex(x, y);
    if (i < 0) {
      nodes.push({ x, y });
      i = nodes.length - 1;
    }
    return i;
  };

  const members = raw.map((m) => {
    const dx = m.x2 - m.x1;
    const dy = m.y2 - m.y1;
    const flip = dx < -TOL || (Math.abs(dx) <= TOL && dy < 0);
    const [x0, y0, x1, y1] = flip ? [m.x2, m.y2, m.x1, m.y1] : [m.x1, m.y1, m.x2, m.y2];
    const length = Math.hypot(x1 - x0, y1 - y0);
    const t = [(x1 - x0) / length, (y1 - y0) / length];
    nodeAt(x0, y0);
    nodeAt(x1, y1);
    return { id: m.id, x0, y0, x1, y1, length, t, n: [-t[1], t[0]] };
  });

  const along = (m, x, y) => {
    const dx = x - m.x0;
    const dy = y - m.y0;
    return { s: dx * m.t[0] + dy * m.t[1], off: dx * m.n[0] + dy * m.n[1] };
  };

  // A hinge must sit at a joint or inside a member.
  for (const h of problem.hinges ?? []) {
    if (nodeIndex(h.x, h.y) >= 0) continue;
    const host = members.find((m) => {
      const { s, off } = along(m, h.x, h.y);
      return Math.abs(off) < TOL && s > 0 && s < m.length;
    });
    if (!host) return { error: 'A hinge is not on a member. Place it on a member or at a joint.' };
    nodeAt(h.x, h.y);
  }

  // Split members at every joint that touches their interior.
  const segments = [];
  for (const m of members) {
    const inner = [];
    nodes.forEach((p, i) => {
      const { s, off } = along(m, p.x, p.y);
      if (Math.abs(off) < TOL && s > TOL && s < m.length - TOL) inner.push({ i, s });
    });
    inner.sort((p, q) => p.s - q.s);
    const chain = [nodeAt(m.x0, m.y0), ...inner.map((p) => p.i), nodeAt(m.x1, m.y1)];
    for (let k = 0; k < chain.length - 1; k++) {
      const a = nodes[chain[k]];
      const b = nodes[chain[k + 1]];
      segments.push({
        id: m.id,
        a: chain[k],
        b: chain[k + 1],
        x0: a.x,
        y0: a.y,
        x1: b.x,
        y1: b.y,
        length: Math.hypot(b.x - a.x, b.y - a.y),
        t: m.t,
        n: m.n,
        points: [],
        udls: [],
      });
    }
  }

  const adj = nodes.map(() => []);
  segments.forEach((sg, k) => {
    adj[sg.a].push({ segment: k, other: sg.b });
    adj[sg.b].push({ segment: k, other: sg.a });
  });

  const visited = new Set();
  let components = 0;
  for (let start = 0; start < adj.length; start++) {
    if (adj[start].length === 0 || visited.has(start)) continue;
    components++;
    const stack = [start];
    visited.add(start);
    while (stack.length) {
      const u = stack.pop();
      for (const edge of adj[u]) {
        if (visited.has(edge.other)) continue;
        visited.add(edge.other);
        stack.push(edge.other);
      }
    }
  }
  if (components > 1) {
    return { error: 'Members are not connected. Join them at a common joint or intersection.' };
  }

  // Distributed loads become portions on whichever segments they lie along.
  for (const d of problem.distributed) {
    const len = Math.hypot(d.x2 - d.x1, d.y2 - d.y1);
    if (len < TOL) return { error: 'A distributed load has zero length. Move its endpoints apart or delete it.' };
    const [dx, dy] = directionOf(d.angle);
    const w1 = d.w;
    const w2 = d.w2 ?? d.w;
    let covered = 0;
    for (const sg of segments) {
      const p1 = along(sg, d.x1, d.y1);
      const p2 = along(sg, d.x2, d.y2);
      if (Math.abs(p1.off) > TOL || Math.abs(p2.off) > TOL) continue;
      const lo = Math.max(Math.min(p1.s, p2.s), 0);
      const hi = Math.min(Math.max(p1.s, p2.s), sg.length);
      if (hi - lo > TOL) {
        // Intensity varies linearly from w1 at the load's start to w2 at its end.
        const at = (s) => w1 + ((w2 - w1) * (s - p1.s)) / (p2.s - p1.s);
        sg.udls.push({ lo, hi, wa: at(lo), wb: at(hi), dx, dy });
        covered += hi - lo;
      }
    }
    if (covered < len - TOL) return { error: 'A distributed load is not on a member. Draw it along a member.' };
  }

  /** Where a point sits: at a joint, inside a segment, or nowhere. */
  const locate = (x, y) => {
    const ni = nodeIndex(x, y);
    if (ni >= 0) return { node: ni };
    for (let k = 0; k < segments.length; k++) {
      const { s, off } = along(segments[k], x, y);
      if (Math.abs(off) < TOL && s > 0 && s < segments[k].length) return { segment: k, s };
    }
    return null;
  };

  for (const [items, pointName] of [
    [problem.supports, 'support'],
    [problem.forces, 'point force'],
    [problem.moments, 'applied moment'],
  ]) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!locate(item.x, item.y)) {
        return {
          error: `The ${pointName} ${i + 1} is not on a member. Place it on a member or joint.`,
        };
      }
    }
  }

  /**
   * The separate parts of the frame that meet at joint `hn` (one per member end there).
   * Each branch lists its joints and segments. Fails if two parts are connected
   * some other way, because then the joint does not split the frame.
   */
  const branches = (hn) => {
    const used = new Set();
    const result = [];
    for (const e of adj[hn]) {
      const nodeSet = new Set([e.other]);
      const segSet = new Set([e.segment]);
      const stack = [e.other];
      while (stack.length) {
        const u = stack.pop();
        for (const f of adj[u]) {
          if (f.segment === e.segment) continue;
          if (f.other === hn) return { error: LOOP };
          segSet.add(f.segment);
          if (!nodeSet.has(f.other)) {
            nodeSet.add(f.other);
            stack.push(f.other);
          }
        }
      }
      for (const v of nodeSet) if (used.has(v)) return { error: LOOP };
      nodeSet.forEach((v) => used.add(v));

      const far = nodes[e.other];
      const dx = far.x - nodes[hn].x;
      const dy = far.y - nodes[hn].y;
      const side = Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy > 0 ? 'above' : 'below';
      result.push({ nodes: nodeSet, segs: segSet, side });
    }
    return { branches: result };
  };

  return { nodes, segments, adj, nodeIndex, locate, branches };
}

/** Is a located point (from `locate`) part of this branch? */
export function inBranch(branch, loc) {
  if (!loc) return false;
  return loc.node !== undefined ? branch.nodes.has(loc.node) : branch.segs.has(loc.segment);
}
