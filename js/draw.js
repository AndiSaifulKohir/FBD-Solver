/**
 * SVG rendering. Takes a problem and its solution, returns SVG markup.
 *
 * World coordinates are metres with +y up. Screen coordinates are pixels with +y
 * down. The camera maps one to the other, so zooming and panning only change
 * the camera. Symbols and arrows keep their pixel size at any zoom.
 */
import { directionOf } from './mathutil.js';
import { fmt } from './format.js';
import { pointKeys } from './model.js';
import { DIAGRAM_INFO } from './internal.js';
import { toDisplay, unitLabel, fromDisplay } from './units.js';
import { dimensionChains, boundsOf } from './dimensions.js';

export const VIEW = { w: 1000, h: 620 };

/* ---------- camera ---------- */

export const MIN_SCALE = 8; // pixels per metre
export const MAX_SCALE = 500;

/** World to screen: screen = origin + world * scale (y flipped). Mutated by zoom, pan and fit. */
export const camera = { scale: 60, ox: 150, oy: 520 };

export const toScreen = (x, y) => [camera.ox + x * camera.scale, camera.oy - y * camera.scale];
export const toWorld = (px, py) => ({ x: (px - camera.ox) / camera.scale, y: (camera.oy - py) / camera.scale });

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Zoom by a factor, keeping the world point under screen position (px, py) fixed. */
export function zoomAt(factor, px, py) {
  const w = toWorld(px, py);
  camera.scale = clamp(camera.scale * factor, MIN_SCALE, MAX_SCALE);
  camera.ox = px - w.x * camera.scale;
  camera.oy = py + w.y * camera.scale;
}

export function panBy(dx, dy) {
  camera.ox += dx;
  camera.oy += dy;
}

/**
 * Centre the drawing in the view and zoom to fit it. Leaves room around it for
 * loads, reaction labels and dimension lines. An empty problem is centred on a
 * typical 10 m by 6 m area.
 */
export function fitCamera(problem, { dims = true } = {}) {
  const b = boundsOf(problem);
  if (!b) {
    camera.scale = 60;
    camera.ox = VIEW.w / 2 - 5 * camera.scale;
    camera.oy = VIEW.h / 2 + 3 * camera.scale;
    return;
  }
  const pad = { left: dims ? 150 : 130, right: 130, top: 120, bottom: dims ? 130 : 100 };
  const availW = VIEW.w - pad.left - pad.right;
  const availH = VIEW.h - pad.top - pad.bottom;
  const bw = b.maxX - b.minX;
  const bh = b.maxY - b.minY;
  const sx = bw > 1e-9 ? availW / bw : Infinity;
  const sy = bh > 1e-9 ? availH / bh : Infinity;
  const fitted = Math.min(sx, sy, 100);
  camera.scale = clamp(Number.isFinite(fitted) ? fitted : 60, 15, MAX_SCALE);

  const cx = (pad.left + VIEW.w - pad.right) / 2;
  const cy = (pad.top + VIEW.h - pad.bottom) / 2;
  camera.ox = cx - ((b.minX + b.maxX) / 2) * camera.scale;
  camera.oy = cy + ((b.minY + b.maxY) / 2) * camera.scale;
}

/**
 * Grid spacing and snap step for the current zoom and length unit. Lines are at
 * least 40 px apart and sit on round numbers of the display unit (1, 2, 5, 10...).
 * The snap step is a round fraction of the grid spacing.
 */
export function gridSteps() {
  const unit = fromDisplay('length', 1); // metres per display unit
  const minDisp = 40 / (camera.scale * unit);
  const exp = Math.floor(Math.log10(minDisp));
  const base = 10 ** exp;
  const m = [1, 2, 5, 10].find((k) => k * base >= minDisp * (1 - 1e-12));
  const stepDisp = m * base;
  const snapDisp = m === 2 ? stepDisp / 4 : m === 5 ? stepDisp / 5 : stepDisp / 2;
  const round = (v) => +v.toPrecision(12);
  return {
    stepDisp: round(stepDisp),
    snapDisp: round(snapDisp),
    stepM: round(stepDisp * unit),
    snapM: round(snapDisp * unit),
  };
}

/** Snap step in metres for the current zoom and unit. */
export const snapStep = () => gridSteps().snapM;

/* ---------- display helpers ---------- */

const r2 = (n) => Math.round(n * 100) / 100;

const fF = (v) => fmt(toDisplay('force', v));
const fM = (v) => fmt(toDisplay('moment', v));
const fL = (v) => fmt(toDisplay('length', v));
const fD = (v) => fmt(toDisplay('dist', v));
const sgn = (text, v) => `${v > 0 ? '+' : ''}${text}`;

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
  const { stepM, stepDisp } = gridSteps();
  const left = toWorld(0, 0).x;
  const right = toWorld(VIEW.w, 0).x;
  const top = toWorld(0, 0).y;
  const bottom = toWorld(0, VIEW.h).y;
  let s = '<g class="grid">';

  for (let i = Math.ceil(left / stepM); i <= Math.floor(right / stepM); i++) {
    const [px] = toScreen(i * stepM, 0);
    s += `<line class="${i === 0 ? 'axis' : ''}" x1="${r2(px)}" y1="0" x2="${r2(px)}" y2="${VIEW.h}"/>`;
    s += `<text x="${r2(px + 4)}" y="${VIEW.h - 6}">${fmt(i * stepDisp)}</text>`;
  }
  for (let j = Math.ceil(bottom / stepM); j <= Math.floor(top / stepM); j++) {
    const [, py] = toScreen(0, j * stepM);
    s += `<line class="${j === 0 ? 'axis' : ''}" x1="0" y1="${r2(py)}" x2="${VIEW.w}" y2="${r2(py)}"/>`;
    s += `<text x="4" y="${r2(py - 4)}">${fmt(j * stepDisp)}</text>`;
  }
  s += `<text class="grid-unit" x="${VIEW.w - 6}" y="${VIEW.h - 22}" text-anchor="end">${unitLabel('length')}</text></g>`;
  return s;
}

/* ---------- dimensions ---------- */

/**
 * Which side of the drawing has fewer horizontal arrows (loads and reactions) at its
 * edge. The dimension column goes there. Ties go to the left.
 */
function dimensionSide(problem, solution, minX, maxX) {
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  let left = 0;
  let right = 0;
  for (const f of problem.forces) {
    const [dx] = directionOf(f.angle);
    if (Math.abs(dx) <= 0.5) continue;
    if (near(f.x, minX) && dx > 0) left++; // the arrow comes in from the left
    if (near(f.x, maxX) && dx < 0) right++;
  }
  if (solution && solution.status === 'solved') {
    for (const r of solution.reactions) {
      if (near(r.x, minX) && r.fx < -1e-9) left++; // the reaction points left
      if (near(r.x, maxX) && r.fx > 1e-9) right++;
    }
  }
  return right < left ? 'right' : 'left';
}

/**
 * Chain dimensions between every distinct position you have defined: a row of
 * distances under the drawing and a column on its left, each with an overall
 * dimension when there are three or more positions.
 */
function dimensionsSvg(problem, solution) {
  const { points, xs, ys } = dimensionChains(problem);
  if (points.length < 2 || (xs.length < 2 && ys.length < 2)) return '';

  const screen = points.map((p) => ({ ...p, sx: toScreen(p.x, p.y)[0], sy: toScreen(p.x, p.y)[1] }));
  const lowest = Math.max(...screen.map((p) => p.sy));
  const leftmost = Math.min(...screen.map((p) => p.sx));
  const rightmost = Math.max(...screen.map((p) => p.sx));
  const tick = (x, y) => `<line class="dim-tick" x1="${r2(x - 4)}" y1="${r2(y + 4)}" x2="${r2(x + 4)}" y2="${r2(y - 4)}"/>`;
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  let s = '<g class="dims">';

  if (xs.length >= 2) {
    const row = (list, yd, extend) => {
      let out = '';
      list.forEach((x, i) => {
        const px = toScreen(x, 0)[0];
        const owners = screen.filter((p) => near(p.x, x));
        const from = Math.max(...owners.map((p) => p.sy)) + 8;
        out += `<line class="dim-ext" x1="${r2(px)}" y1="${r2(from)}" x2="${r2(px)}" y2="${r2((extend[i] ?? yd) + 6)}"/>`;
        if (i < list.length - 1) {
          const nx = toScreen(list[i + 1], 0)[0];
          out += `<line class="dim-line" x1="${r2(px)}" y1="${r2(yd)}" x2="${r2(nx)}" y2="${r2(yd)}"/>`;
          if (nx - px >= 30) {
            out += `<text class="dim-text" x="${r2((px + nx) / 2)}" y="${r2(yd - 5)}" text-anchor="middle">${fL(list[i + 1] - x)}</text>`;
          }
        }
        out += tick(px, yd);
      });
      return out;
    };
    const y1 = lowest + 78;
    const y2 = y1 + 26;
    const total = xs.length >= 3;
    const extend = total ? { 0: y2, [xs.length - 1]: y2 } : {};
    s += row(xs, y1, extend);
    if (total) s += row([xs[0], xs[xs.length - 1]], y2, {});
    s += `<text class="dim-text dim-unit" x="${r2(toScreen(xs[xs.length - 1], 0)[0] + 10)}" y="${r2(y1 + 4)}">${unitLabel('length')}</text>`;
  }

  if (ys.length >= 2) {
    // Put the column on the side with fewer horizontal arrows, so it stays clear of them.
    const side = dimensionSide(problem, solution, xs[0], xs[xs.length - 1]);
    const dir = side === 'right' ? 1 : -1; // which way the column grows from the drawing
    const col = (list, xd, extend) => {
      let out = '';
      list.forEach((y, i) => {
        const py = toScreen(0, y)[1];
        const owners = screen.filter((p) => near(p.y, y));
        const from = side === 'right' ? Math.max(...owners.map((p) => p.sx)) + 8 : Math.min(...owners.map((p) => p.sx)) - 8;
        out += `<line class="dim-ext" x1="${r2(from)}" y1="${r2(py)}" x2="${r2((extend[i] ?? xd) + dir * 6)}" y2="${r2(py)}"/>`;
        if (i < list.length - 1) {
          const ny = toScreen(0, list[i + 1])[1];
          out += `<line class="dim-line" x1="${r2(xd)}" y1="${r2(py)}" x2="${r2(xd)}" y2="${r2(ny)}"/>`;
          if (Math.abs(py - ny) >= 30) {
            const cy = (py + ny) / 2;
            const tx = xd + dir * (side === 'right' ? 17 : 5); // rotated text grows to the left of its baseline
            out += `<text class="dim-text" transform="rotate(-90 ${r2(tx)} ${r2(cy)})" x="${r2(tx)}" y="${r2(cy)}" text-anchor="middle">${fL(list[i + 1] - y)}</text>`;
          }
        }
        out += tick(xd, py);
      });
      return out;
    };
    const x1 = side === 'right' ? rightmost + 78 : leftmost - 78;
    const x2 = x1 + dir * 26;
    const total = ys.length >= 3;
    const extend = total ? { 0: x2, [ys.length - 1]: x2 } : {};
    s += col(ys, x1, extend);
    if (total) s += col([ys[0], ys[ys.length - 1]], x2, {});
  }
  return `${s}</g>`;
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
    const text = state === 'zero' ? '0' : `${fF(Math.abs(bar.force))} ${state === 'tension' ? 'T' : 'C'}`;
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
    tailLabel(x0, y0, sx, sy, `${fF(f.magnitude)} ${unitLabel('force')}`);
  return group('force', f.id, selected, inner);
}

function momentSvg(c, selected) {
  const [cx, cy] = toScreen(c.x, c.y);
  const inner =
    `<circle class="hit-fill" cx="${cx}" cy="${cy}" r="30"/>` +
    momentArc(cx, cy, c.value, 24) +
    `<circle class="dot" cx="${cx}" cy="${cy}" r="3.5"/>` +
    `<text class="label" x="${cx}" y="${r2(cy - 34)}" text-anchor="middle">${fM(Math.abs(c.value))} ${unitLabel('moment')}</text>`;
  return group('moment', c.id, selected, inner);
}

/**
 * A distributed load. Arrow length follows the intensity, so a triangular or
 * trapezoidal load shows its shape. Where the intensity is negative the arrows
 * point the other way.
 */
function udlSvg(d, selected) {
  const [x1, y1] = toScreen(d.x1, d.y1);
  const [x2, y2] = toScreen(d.x2, d.y2);
  const [sx, sy] = screenDir(d.angle);
  const w1 = d.w;
  const w2 = d.w2 ?? d.w;
  const maxAbs = Math.max(Math.abs(w1), Math.abs(w2));
  const spanPx = Math.hypot(x2 - x1, y2 - y1);
  const n = Math.min(41, Math.max(2, Math.round(spanPx / 28) + 1));
  const maxLen = 40;

  const tails = [];
  const intensities = [];
  let arrows = '';
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const w = w1 + (w2 - w1) * t;
    const px = x1 + (x2 - x1) * t;
    const py = y1 + (y2 - y1) * t;
    const len = maxAbs > 0 ? (maxLen * Math.abs(w)) / maxAbs : 0;
    const dir = w >= 0 ? 1 : -1;
    const tx = px - dir * sx * len;
    const ty = py - dir * sy * len;
    tails.push([tx, ty]);
    intensities.push(w);
    if (len >= 10) arrows += arrow(tx, ty, px, py, 9, 4);
  }

  // Label near the larger end, or at the middle of a uniform load.
  const unit = unitLabel('dist');
  let text;
  let at;
  if (Math.abs(w1 - w2) < 1e-12) {
    text = `${fD(w1)} ${unit}`;
    at = Math.floor(n / 2);
  } else {
    text = `${fD(w1)} → ${fD(w2)} ${unit}`;
    at = Math.abs(w1) >= Math.abs(w2) ? 0 : n - 1;
  }
  const labelDir = intensities[at] >= 0 ? 1 : -1;

  const envelope = tails.map(([x, y]) => `${r2(x)},${r2(y)}`).join(' ');
  const hit = `${r2(x1)},${r2(y1)} ${r2(x2)},${r2(y2)} ${[...tails].reverse().map(([x, y]) => `${r2(x)},${r2(y)}`).join(' ')}`;
  const inner =
    `<polygon class="hit-fill" points="${hit}"/>` +
    `<polyline class="udl-line" points="${envelope}"/>` +
    arrows +
    tailLabel(tails[at][0], tails[at][1], labelDir * sx, labelDir * sy, text);
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
    const text = `${name} = ${fF(mag)} ${unitLabel('force')}`;
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
        `<text class="label" x="${r2(x + 38)}" y="${r2(y + 34)}">M${r.label} = ${fM(Math.abs(r.m))} ${unitLabel('moment')}</text>`;
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
      `<text class="coord" x="${hx + 12}" y="${hy - 10}">${fmt(toDisplay('length', hover.x), 3)}, ${fmt(toDisplay('length', hover.y), 3)} ${unitLabel('length')}</text>`;
  }
  return s;
}

/* ---------- entry point ---------- */

/**
 * @param view { selectedId, pending, hover, tool, dims }
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
    (view.dims ? dimensionsSvg(problem, solution) : '') +
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
  const convert = (v) => toDisplay(info.type, v);
  let s =
    grid() +
    `<g class="dim">${problem.members.map((m) => memberSvg(m, false)).join('')}${(problem.hinges ?? [])
      .map((h) => hingeSvg(h, false))
      .join('')}${problem.supports
      .map((sp, i) => supportSvg(problem, sp, i, false))
      .join('')}</g>` +
    `<text class="diagram-title" x="16" y="28">${info.title} (${unitLabel(info.type)})</text>` +
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
      const text = state === 'zero' ? '0' : sgn(fmt(convert(v)), v);
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
      const bx = ax + st[0] * p.s * camera.scale;
      const by = ay + st[1] * p.s * camera.scale;
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
      const text = sgn(fmt(convert(p.v)), p.v);
      const key = `${Math.round(p.ox / 24)},${Math.round(p.oy / 24)},${text}`;
      if (seenLabels.has(key)) continue;
      seenLabels.add(key);
      const out = side * (p.v >= 0 ? 1 : -1);
      s += `<text class="label" x="${r2(p.ox + sn[0] * out * 14)}" y="${r2(p.oy + sn[1] * out * 14 + 4)}" text-anchor="middle">${text}</text>`;
    }
  }
  return s;
}
