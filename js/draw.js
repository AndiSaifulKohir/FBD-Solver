/**
 * SVG rendering. Takes a problem and its solution, returns SVG markup.
 * World coordinates are metres with +y up; screen coordinates are pixels with +y down.
 */
import { directionOf } from './mathutil.js';
import { fmt } from './format.js';
import { pointKeys } from './model.js';
import { DIAGRAM_INFO } from './internal.js';

export const SCALE = 60; // pixels per metre
export const ORIGIN = { x: 150, y: 520 };
export const VIEW = { w: 1000, h: 620 };
export const SNAP = 0.5; // metres

export const toScreen = (x, y) => [ORIGIN.x + x * SCALE, ORIGIN.y - y * SCALE];
export const toWorld = (px, py) => ({ x: (px - ORIGIN.x) / SCALE, y: (ORIGIN.y - py) / SCALE });

const r2 = (n) => Math.round(n * 100) / 100;

/** Screen-space unit vector for a world angle in degrees. */
function screenDir(angle) {
  const [dx, dy] = directionOf(Number.isFinite(angle) ? angle : 0);
  return [dx, -dy];
}

/* ---------- primitives ---------- */

function head(tipX, tipY, ux, uy, len = 11, half = 5) {
  const bx = tipX - ux * len;
  const by = tipY - uy * len;
  return `<polygon points="${r2(tipX)},${r2(tipY)} ${r2(bx - uy * half)},${r2(by + ux * half)} ${r2(bx + uy * half)},${r2(by - ux * half)}"/>`;
}

function arrow(x1, y1, x2, y2, len = 11, half = 5) {
  const d = Math.hypot(x2 - x1, y2 - y1) || 1;
  const ux = (x2 - x1) / d;
  const uy = (y2 - y1) / d;
  const ex = x2 - ux * len * 0.6;
  const ey = y2 - uy * len * 0.6;
  return `<g class="arrow"><line x1="${r2(x1)}" y1="${r2(y1)}" x2="${r2(ex)}" y2="${r2(ey)}"/>${head(x2, y2, ux, uy, len, half)}</g>`;
}

/** Arc with an arrowhead. Counterclockwise when value >= 0. */
function momentArc(cx, cy, value, r) {
  const dir = value >= 0 ? 1 : -1;
  const start = dir > 0 ? -40 : 220;
  const sweep = 260;
  const steps = 28;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = ((start + (dir * sweep * i) / steps) * Math.PI) / 180;
    pts.push([cx + r * Math.cos(a), cy - r * Math.sin(a)]);
  }
  const end = ((start + dir * sweep) * Math.PI) / 180;
  const tx = dir * -Math.sin(end);
  const ty = -dir * Math.cos(end); // screen y is flipped
  const [ex, ey] = pts[pts.length - 1];
  return `<g class="arc-group"><polyline class="arc" points="${pts.map(([x, y]) => `${r2(x)},${r2(y)}`).join(' ')}"/>${head(ex, ey, tx, ty)}</g>`;
}

/** Label placed behind an arrow's tail. */
function tailLabel(tx, ty, sx, sy, text) {
  let x = tx - sx * 8;
  let y = ty - sy * 8;
  let anchor = 'middle';
  if (Math.abs(sx) > 0.5) {
    anchor = sx > 0 ? 'end' : 'start';
    y += 4;
  } else {
    y += sy > 0 ? -2 : 12;
  }
  return `<text class="label" x="${r2(x)}" y="${r2(y)}" text-anchor="${anchor}">${text}</text>`;
}

/** Label placed beyond an arrow's tip. */
function tipLabel(tx, ty, sx, sy, text) {
  let x = tx + sx * 8;
  let y = ty + sy * 8;
  let anchor = 'middle';
  if (Math.abs(sx) > 0.5) {
    anchor = sx > 0 ? 'start' : 'end';
    y += 4;
  } else {
    y += sy > 0 ? 12 : -2;
  }
  return `<text class="label" x="${r2(x)}" y="${r2(y)}" text-anchor="${anchor}">${text}</text>`;
}

const group = (kind, id, selected, inner) =>
  `<g class="item ${kind}${selected ? ' selected' : ''}" data-id="${id}" data-kind="${kind}">${inner}</g>`;

/* ---------- grid ---------- */

function grid() {
  let s = '<g class="grid">';
  const xMin = Math.ceil(-ORIGIN.x / SCALE);
  const xMax = Math.floor((VIEW.w - ORIGIN.x) / SCALE);
  const yMin = Math.ceil((ORIGIN.y - VIEW.h) / SCALE);
  const yMax = Math.floor(ORIGIN.y / SCALE);

  for (let x = xMin; x <= xMax; x++) {
    const [px] = toScreen(x, 0);
    s += `<line class="${x === 0 ? 'axis' : ''}" x1="${px}" y1="0" x2="${px}" y2="${VIEW.h}"/>`;
    if (x >= 0 && x % 2 === 0) s += `<text x="${px + 4}" y="${VIEW.h - 6}">${x}</text>`;
  }
  for (let y = yMin; y <= yMax; y++) {
    const [, py] = toScreen(0, y);
    s += `<line class="${y === 0 ? 'axis' : ''}" x1="0" y1="${py}" x2="${VIEW.w}" y2="${py}"/>`;
    if (y > 0 && y % 2 === 0) s += `<text x="4" y="${py - 4}">${y}</text>`;
  }
  s += `<text x="${VIEW.w - 22}" y="${VIEW.h - 6}">m</text></g>`;
  return s;
}

/* ---------- items ---------- */

function memberSvg(m, selected) {
  const [x1, y1] = toScreen(m.x1, m.y1);
  const [x2, y2] = toScreen(m.x2, m.y2);
  const inner =
    `<line class="hit" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>` +
    `<line class="body" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>` +
    `<circle class="joint" cx="${x1}" cy="${y1}" r="5"/>` +
    `<circle class="joint" cx="${x2}" cy="${y2}" r="5"/>`;
  return group('member', m.id, selected, inner);
}

/** Which side of a fixed support the wall is drawn on, based on connected members. */
function wallSide(problem, s) {
  const near = (x, y) => Math.abs(x - s.x) < 0.01 && Math.abs(y - s.y) < 0.01;
  let sum = 0;
  for (const m of problem.members) {
    if (near(m.x1, m.y1)) sum += m.x2 - m.x1;
    else if (near(m.x2, m.y2)) sum += m.x1 - m.x2;
  }
  return sum >= 0 ? -1 : 1; // -1: wall on the left
}

function hatch(x0, x1, y, step, dx, dy) {
  let s = '';
  for (let x = x0; x <= x1; x += step) {
    s += `<line class="hatch" x1="${x}" y1="${y}" x2="${x + dx}" y2="${y + dy}"/>`;
  }
  return s;
}

function hingeSvg(h, selected) {
  const [x, y] = toScreen(h.x, h.y);
  return group(
    'hinge',
    h.id,
    selected,
    `<circle class="hit-fill" cx="${x}" cy="${y}" r="14"/><circle class="hinge-dot" cx="${x}" cy="${y}" r="7"/>`
  );
}

/** A truss bar, coloured by tension or compression once solved. */
function trussBarSvg(m, selected, bar) {
  const [x1, y1] = toScreen(m.x1, m.y1);
  const [x2, y2] = toScreen(m.x2, m.y2);
  const state = bar ? bar.state : 'idle';
  let label = '';
  if (bar) {
    const text = state === 'zero' ? '0' : `${fmt(Math.abs(bar.force))} ${state === 'tension' ? 'T' : 'C'}`;
    label = `<text class="label" x="${r2((x1 + x2) / 2)}" y="${r2((y1 + y2) / 2 + 4)}" text-anchor="middle">${text}</text>`;
  }
  const halo = selected ? `<line class="bar-halo" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>` : '';
  return (
    `<g class="item member bar bar-${state}" data-id="${m.id}" data-kind="member">` +
    `${halo}<line class="hit" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>` +
    `<line class="body" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>${label}</g>`
  );
}

/** Numbered joints of a truss. */
function jointsSvg(solution) {
  if (!solution || !solution.joints) return '';
  return `<g class="joints">${solution.joints
    .map((j) => {
      const [x, y] = toScreen(j.x, j.y);
      return `<circle class="joint-mark" cx="${x}" cy="${y}" r="10"/><text class="joint-num" x="${x}" y="${y + 4}" text-anchor="middle">${j.label}</text>`;
    })
    .join('')}</g>`;
}

function supportSvg(problem, s, index, selected) {
  const [x, y] = toScreen(s.x, s.y);
  let transform = `translate(${x} ${y})`;
  let sym = '';

  if (s.type === 'pin') {
    sym =
      `<polygon class="sym" points="0,0 -14,22 14,22"/>` +
      `<line class="ground" x1="-22" y1="22" x2="22" y2="22"/>` +
      hatch(-20, 20, 22, 8, -7, 9);
  } else if (s.type === 'roller') {
    const angle = Number.isFinite(s.angle) ? s.angle : 90;
    transform += ` rotate(${-(angle - 90)})`;
    sym =
      `<polygon class="sym" points="0,0 -12,18 12,18"/>` +
      `<circle class="sym" cx="-6.5" cy="22.5" r="4.5"/><circle class="sym" cx="6.5" cy="22.5" r="4.5"/>` +
      `<line class="ground" x1="-22" y1="27" x2="22" y2="27"/>` +
      hatch(-20, 20, 27, 8, -7, 9);
  } else {
    if (wallSide(problem, s) > 0) transform += ' scale(-1 1)';
    let h = '';
    for (let yy = -28; yy <= 24; yy += 8) h += `<line class="hatch" x1="0" y1="${yy}" x2="-9" y2="${yy + 9}"/>`;
    sym = `<line class="ground" x1="0" y1="-28" x2="0" y2="28"/>${h}`;
  }

  const name = String.fromCharCode(65 + (index % 26));
  return group(
    'support',
    s.id,
    selected,
    `<g transform="${transform}"><circle class="hit-fill" r="18"/>${sym}</g>` +
      `<text class="label name" x="${r2(x - 16)}" y="${r2(y - 12)}" text-anchor="end">${index < 26 ? name : `S${index + 1}`}</text>`
  );
}

function forceSvg(f, selected) {
  const [tx, ty] = toScreen(f.x, f.y);
  const [sx, sy] = screenDir(f.angle);
  const len = 72;
  const x0 = tx - sx * len;
  const y0 = ty - sy * len;
  const inner =
    `<line class="hit" x1="${r2(x0)}" y1="${r2(y0)}" x2="${tx}" y2="${ty}"/>` +
    arrow(x0, y0, tx, ty) +
    `<circle class="dot" cx="${tx}" cy="${ty}" r="3.5"/>` +
    tailLabel(x0, y0, sx, sy, `${fmt(f.magnitude)} kN`);
  return group('force', f.id, selected, inner);
}

function momentSvg(c, selected) {
  const [cx, cy] = toScreen(c.x, c.y);
  const inner =
    `<circle class="hit-fill" cx="${cx}" cy="${cy}" r="30"/>` +
    momentArc(cx, cy, c.value, 24) +
    `<circle class="dot" cx="${cx}" cy="${cy}" r="3.5"/>` +
    `<text class="label" x="${cx}" y="${r2(cy - 34)}" text-anchor="middle">${fmt(Math.abs(c.value))} kN·m</text>`;
  return group('moment', c.id, selected, inner);
}

function udlSvg(d, selected) {
  const [x1, y1] = toScreen(d.x1, d.y1);
  const [x2, y2] = toScreen(d.x2, d.y2);
  const [sx, sy] = screenDir(d.angle);
  const lengthM = Math.hypot(d.x2 - d.x1, d.y2 - d.y1);
  const n = Math.min(41, Math.max(2, Math.round(lengthM / 0.5) + 1));
  const arrowLen = 36;

  const tails = [];
  let arrows = '';
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const px = x1 + (x2 - x1) * t;
    const py = y1 + (y2 - y1) * t;
    const tx = px - sx * arrowLen;
    const ty = py - sy * arrowLen;
    tails.push([tx, ty]);
    arrows += arrow(tx, ty, px, py, 9, 4);
  }
  const first = tails[0];
  const last = tails[tails.length - 1];
  const midX = (first[0] + last[0]) / 2;
  const midY = (first[1] + last[1]) / 2;

  const inner =
    `<polygon class="hit-fill" points="${r2(x1)},${r2(y1)} ${r2(x2)},${r2(y2)} ${r2(last[0])},${r2(last[1])} ${r2(first[0])},${r2(first[1])}"/>` +
    `<line class="udl-line" x1="${r2(first[0])}" y1="${r2(first[1])}" x2="${r2(last[0])}" y2="${r2(last[1])}"/>` +
    arrows +
    tailLabel(midX, midY, sx, sy, `${fmt(d.w)} kN/m`);
  return group('udl', d.id, selected, inner);
}

/* ---------- solution overlay ---------- */

function reactionsSvg(solution) {
  if (!solution || solution.status !== 'solved') return '';
  const len = 58;
  let s = '<g class="reaction">';
  const truss = solution.mode === 'truss' && solution.joints.length > 0;
  const centreX = truss ? solution.joints.reduce((a, j) => a + toScreen(j.x, 0)[0], 0) / solution.joints.length : 0;

  const component = (x, y, fx, fy, name) => {
    const mag = Math.hypot(fx, fy);
    if (mag < 1e-9) return '';
    const ux = fx / mag;
    const uy = -fy / mag;
    const x2 = x + ux * len;
    const y2 = y + uy * len;
    const text = `${name} = ${fmt(mag)} kN`;
    if (truss && Math.abs(ux) < 0.5) {
      // Keep the label clear of the bars: put it on the outer side of the arrow.
      const side = x >= centreX ? 1 : -1;
      return (
        arrow(x, y, x2, y2) +
        `<text class="label" x="${r2(x2 + side * 10)}" y="${r2(y2 + 4)}" text-anchor="${side > 0 ? 'start' : 'end'}">${text}</text>`
      );
    }
    return arrow(x, y, x2, y2) + tipLabel(x2, y2, ux, uy, text);
  };

  for (const r of solution.reactions) {
    const [x, y] = toScreen(r.x, r.y);
    if (r.type === 'roller') {
      s += component(x, y, r.fx, r.fy, r.label);
    } else {
      s += component(x, y, r.fx, 0, `${r.label}x`);
      s += component(x, y, 0, r.fy, `${r.label}y`);
    }
    if (r.type === 'fixed' && Math.abs(r.m) > 1e-9) {
      s +=
        momentArc(x, y, r.m, 32) +
        `<text class="label" x="${r2(x + 38)}" y="${r2(y + 34)}">M${r.label} = ${fmt(Math.abs(r.m))} kN·m</text>`;
    }
  }
  return `${s}</g>`;
}

function handlesSvg(kind, item) {
  return pointKeys(kind)
    .map(([kx, ky], i) => {
      const [x, y] = toScreen(item[kx], item[ky]);
      return `<circle class="handle" data-handle="${i}" cx="${x}" cy="${y}" r="7"/>`;
    })
    .join('');
}

function previewSvg(view) {
  let s = '';
  const { hover, pending, tool } = view;
  if (pending) {
    const [px, py] = toScreen(pending.x, pending.y);
    if (hover) {
      const [hx, hy] = toScreen(hover.x, hover.y);
      s += `<line class="preview" x1="${px}" y1="${py}" x2="${hx}" y2="${hy}"/>`;
    }
    s += `<circle class="preview-dot" cx="${px}" cy="${py}" r="5"/>`;
  }
  if (hover && tool !== 'select') {
    const [hx, hy] = toScreen(hover.x, hover.y);
    s +=
      `<g class="cursor"><line x1="${hx - 10}" y1="${hy}" x2="${hx + 10}" y2="${hy}"/><line x1="${hx}" y1="${hy - 10}" x2="${hx}" y2="${hy + 10}"/></g>` +
      `<text class="coord" x="${hx + 12}" y="${hy - 10}">${fmt(hover.x, 2)}, ${fmt(hover.y, 2)} m</text>`;
  }
  return s;
}

/* ---------- entry point ---------- */

/**
 * @param view { selectedId, pending, hover, tool }
 */
export function render(problem, solution, view) {
  const sel = view.selectedId;
  const isSel = (item) => item.id === sel;
  let selectedHandles = '';

  const pick = (kind, items) => {
    const found = items.find(isSel);
    if (found) selectedHandles = handlesSvg(kind, found);
  };
  pick('member', problem.members);
  pick('support', problem.supports);
  pick('force', problem.forces);
  pick('moment', problem.moments);
  pick('udl', problem.distributed);
  pick('hinge', problem.hinges ?? []);

  const truss = problem.mode === 'truss';
  const bars = truss && solution && solution.bars ? new Map(solution.bars.map((b) => [b.id, b])) : new Map();
  const memberSvgs = problem.members.map((m) =>
    truss ? trussBarSvg(m, isSel(m), bars.get(m.id)) : memberSvg(m, isSel(m))
  );

  return (
    grid() +
    problem.distributed.map((d) => udlSvg(d, isSel(d))).join('') +
    memberSvgs.join('') +
    (problem.hinges ?? []).map((h) => hingeSvg(h, isSel(h))).join('') +
    problem.supports.map((s, i) => supportSvg(problem, s, i, isSel(s))).join('') +
    (truss ? jointsSvg(solution) : '') +
    problem.forces.map((f) => forceSvg(f, isSel(f))).join('') +
    problem.moments.map((c) => momentSvg(c, isSel(c))).join('') +
    reactionsSvg(solution) +
    selectedHandles +
    previewSvg(view)
  );
}

/* ---------- internal force diagrams ---------- */

function wrapLines(text, max = 88) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && (line + ' ' + word).length > max) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function note(text) {
  return wrapLines(text)
    .map((line, i) => `<text class="diagram-note" x="${VIEW.w / 2}" y="${VIEW.h / 2 + i * 22}" text-anchor="middle">${line}</text>`)
    .join('');
}

/**
 * Draw one internal force diagram (N, V or M) over a dimmed copy of the frame.
 * N and V are drawn on the left of each member as drawn; M on its tension side.
 */
export function renderDiagram(problem, solution, internal, kind) {
  const info = DIAGRAM_INFO[kind];
  let s =
    grid() +
    `<g class="dim">${problem.members.map((m) => memberSvg(m, false)).join('')}${(problem.hinges ?? [])
      .map((h) => hingeSvg(h, false))
      .join('')}${problem.supports
      .map((sp, i) => supportSvg(problem, sp, i, false))
      .join('')}</g>` +
    `<text class="diagram-title" x="16" y="28">${info.title} (${info.unit})</text>` +
    `<text class="diagram-sub" x="16" y="48">${info.note}</text>`;

  if (internal.status !== 'ok') return s + note(internal.message);

  const maxAbs = Math.max(0, ...internal.members.flatMap((m) => m.stations.map((st) => Math.abs(st[kind]))));
  if (maxAbs < 1e-9) return s + note(`${info.title} is zero everywhere for this loading.`);

  // Trusses: a force map. Each bar's thickness shows the size of its force.
  if (internal.members.every((m) => m.constant)) {
    s += '<g class="forcemap">';
    for (const m of internal.members) {
      const v = m.stations[0].N;
      const [x1, y1] = toScreen(m.x0, m.y0);
      const [x2, y2] = toScreen(m.x1, m.y1);
      const state = Math.abs(v) < maxAbs * 1e-9 ? 'zero' : v > 0 ? 'pos' : 'neg';
      const width = state === 'zero' ? 3 : 4 + (14 * Math.abs(v)) / maxAbs;
      s += `<line class="fm fm-${state}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke-width="${r2(width)}"/>`;

      // Label on the bar itself (with a halo) so neighbouring labels cannot collide.
      const text = state === 'zero' ? '0' : `${v > 0 ? '+' : ''}${fmt(v)}`;
      s += `<text class="label fm-label" x="${r2((x1 + x2) / 2)}" y="${r2((y1 + y2) / 2 + 4)}" text-anchor="middle">${text}</text>`;
    }
    return `${s}</g>${jointsSvg(solution)}`;
  }

  const k = 70 / maxAbs; // pixels per unit of the diagram
  const side = kind === 'M' ? -1 : 1;
  const seenLabels = new Set();

  for (const m of internal.members) {
    const [ax, ay] = toScreen(m.x0, m.y0);
    const st = [m.t[0], -m.t[1]]; // member direction on screen
    const sn = [m.n[0], -m.n[1]]; // member normal on screen

    const pts = m.stations.map((p) => {
      const bx = ax + st[0] * p.s * SCALE;
      const by = ay + st[1] * p.s * SCALE;
      const off = side * p[kind] * k;
      return { bx, by, ox: bx + sn[0] * off, oy: by + sn[1] * off, v: p[kind], edge: p.edge };
    });

    const ring = (pick) => {
      const first = pts[0];
      const last = pts[pts.length - 1];
      const body = pts.map((p) => {
        const off = side * pick(p.v) * k;
        return [p.bx + sn[0] * off, p.by + sn[1] * off];
      });
      return [[first.bx, first.by], ...body, [last.bx, last.by]].map(([x, y]) => `${r2(x)},${r2(y)}`).join(' ');
    };

    s += `<polygon class="dpos" points="${ring((v) => Math.max(v, 0))}"/>`;
    s += `<polygon class="dneg" points="${ring((v) => Math.min(v, 0))}"/>`;
    s += `<polyline class="dline" points="${pts.map((p) => `${r2(p.ox)},${r2(p.oy)}`).join(' ')}"/>`;
    for (const p of [pts[0], pts[pts.length - 1]]) {
      s += `<line class="dline" x1="${r2(p.bx)}" y1="${r2(p.by)}" x2="${r2(p.ox)}" y2="${r2(p.oy)}"/>`;
    }

    // Label segment ends and the member's largest and smallest values.
    const hi = pts.reduce((a, b) => (b.v > a.v ? b : a));
    const lo = pts.reduce((a, b) => (b.v < a.v ? b : a));
    const candidates = m.constant ? new Set([pts[Math.floor(pts.length / 2)]]) : new Set([...pts.filter((p) => p.edge), hi, lo]);
    for (const p of candidates) {
      if (Math.abs(p.v) < maxAbs * 1e-6) continue;
      const text = `${p.v > 0 ? '+' : ''}${fmt(p.v)}`;
      const key = `${Math.round(p.ox / 24)},${Math.round(p.oy / 24)},${text}`;
      if (seenLabels.has(key)) continue;
      seenLabels.add(key);
      const out = side * (p.v >= 0 ? 1 : -1);
      s += `<text class="label" x="${r2(p.ox + sn[0] * out * 14)}" y="${r2(p.oy + sn[1] * out * 14 + 4)}" text-anchor="middle">${text}</text>`;
    }
  }
  return s;
}
