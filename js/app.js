import { supportLabel } from './solver.js';
import { analyze } from './analysis.js';
import { trussAxial } from './truss.js';
import { render, renderDiagram, toWorld, SNAP } from './draw.js';
import { internalForces, DIAGRAM_INFO } from './internal.js';
import {
  emptyProblem,
  normalizeProblem,
  uid,
  findItem,
  removeItem,
  pointKeys,
} from './model.js';
import { fmt, equationText } from './format.js';

const $ = (id) => document.getElementById(id);
const svg = $('canvas');
const propsEl = $('props');
const resultsEl = $('results');
const hintEl = $('hint');
const noticeEl = $('notice');
const undoBtn = $('undo');
const fileInput = $('file');
const examplesEl = $('examples');

/* ---------- state ---------- */

const state = {
  problem: defaultProblem(),
  solution: null,
  internal: null,
  view: 'fbd', // 'fbd' | 'N' | 'V' | 'M'
  selected: null,
  tool: 'select',
  pending: null, // first click of a member or distributed load
  hover: null,
  drag: null,
};
const history = [];

function defaultProblem() {
  return normalizeProblem({
    name: 'Simply supported beam',
    members: [{ x1: 0, y1: 0, x2: 6, y2: 0 }],
    supports: [
      { type: 'pin', x: 0, y: 0 },
      { type: 'roller', x: 6, y: 0, angle: 90 },
    ],
    forces: [{ x: 2, y: 0, magnitude: 12, angle: 270 }],
  });
}

const snap = (v) => Math.round(v / SNAP) * SNAP || 0;

function snapshot() {
  history.push(JSON.stringify(state.problem));
  if (history.length > 100) history.shift();
}

function undo() {
  if (!history.length) return;
  state.problem = JSON.parse(history.pop());
  if (state.selected && !findItem(state.problem, state.selected)) state.selected = null;
  state.pending = null;
  refresh();
}

function notify(text = '') {
  noticeEl.textContent = text;
}

/* ---------- rendering ---------- */

function drawSvg() {
  if (state.view !== 'fbd') {
    svg.innerHTML = renderDiagram(state.problem, state.solution, state.internal, state.view);
    return;
  }
  svg.innerHTML = render(state.problem, state.solution, {
    selectedId: state.selected,
    pending: state.pending,
    hover: state.hover,
    tool: state.tool,
  });
}

function refresh({ panel = true } = {}) {
  state.solution = analyze(state.problem);
  state.internal =
    state.problem.mode === 'truss'
      ? trussAxial(state.problem, state.solution)
      : internalForces(state.problem, state.solution);
  syncControls();
  drawSvg();
  renderResults(state.solution);
  if (panel) renderProps();
  undoBtn.disabled = history.length === 0;
}

const FIELDS = {
  member: [
    ['x1', 'Start x', 'm'],
    ['y1', 'Start y', 'm'],
    ['x2', 'End x', 'm'],
    ['y2', 'End y', 'm'],
  ],
  support: [
    ['x', 'x', 'm'],
    ['y', 'y', 'm'],
  ],
  force: [
    ['x', 'x', 'm'],
    ['y', 'y', 'm'],
    ['magnitude', 'Magnitude', 'kN'],
    ['angle', 'Direction', '°'],
  ],
  moment: [
    ['x', 'x', 'm'],
    ['y', 'y', 'm'],
    ['value', 'Moment', 'kN·m'],
  ],
  hinge: [
    ['x', 'x', 'm'],
    ['y', 'y', 'm'],
  ],
  udl: [
    ['x1', 'Start x', 'm'],
    ['y1', 'Start y', 'm'],
    ['x2', 'End x', 'm'],
    ['y2', 'End y', 'm'],
    ['w', 'Intensity', 'kN/m'],
    ['angle', 'Direction', '°'],
  ],
};

const TITLES = {
  member: 'Member',
  support: 'Support',
  force: 'Point force',
  moment: 'Applied moment',
  udl: 'Distributed load',
  hinge: 'Hinge',
};

const NOTES = {
  force: 'Direction is measured counterclockwise from +x. 270° points down.',
  udl: 'Intensity is per metre of the loaded length. 270° points down.',
  moment: 'Positive is counterclockwise.',
  hinge: 'An internal pin. It carries force but no bending moment, so it adds an equilibrium equation.',
};

function fieldHtml(key, label, unit, value) {
  return `<label class="field"><span class="field-name">${label}</span>
    <span class="field-input"><input type="number" step="any" inputmode="decimal" data-field="${key}" value="${+Number(value).toFixed(4)}"><span class="unit">${unit}</span></span></label>`;
}

function renderProps() {
  const found = state.selected && findItem(state.problem, state.selected);
  if (!found) {
    propsEl.innerHTML =
      '<p class="empty">Nothing selected. Choose a tool and click the drawing, or use Select and click an item.</p>';
    return;
  }
  const { kind, item } = found;
  let html = `<h3>${TITLES[kind]}</h3>`;

  if (kind === 'support') {
    const index = state.problem.supports.indexOf(item);
    html = `<h3>Support ${supportLabel(index)}</h3>
      <label class="field"><span class="field-name">Type</span>
        <span class="field-input"><select data-field="type">
          ${['pin', 'roller', 'fixed']
            .filter((t) => state.problem.mode !== 'truss' || t !== 'fixed' || item.type === 'fixed')
            .map((t) => `<option value="${t}"${t === item.type ? ' selected' : ''}>${t[0].toUpperCase()}${t.slice(1)}</option>`)
            .join('')}
        </select></span></label>`;
  }

  html += FIELDS[kind].map(([key, label, unit]) => fieldHtml(key, label, unit, item[key])).join('');

  if (kind === 'support' && item.type === 'roller') {
    html += fieldHtml('angle', 'Reaction direction', '°', item.angle ?? 90);
    html += '<p class="note">The direction the roller pushes on the body. 90° is up.</p>';
  }
  if (NOTES[kind]) html += `<p class="note">${NOTES[kind]}</p>`;
  html += '<button class="btn danger" type="button" data-action="delete">Delete</button>';
  propsEl.innerHTML = html;
}

const DIRECTION_GLYPH = {
  Rx: (v) => (v > 0 ? '→' : v < 0 ? '←' : ''),
  Ry: (v) => (v > 0 ? '↑' : v < 0 ? '↓' : ''),
  M: (v) => (v > 0 ? '↺' : v < 0 ? '↻' : ''),
};

const signed = (v) => `${v > 0 ? '+' : ''}${fmt(v)}`;

function reactionsList(sol) {
  let html = '<h3>Reactions</h3><dl class="values">';
  for (const u of sol.unknowns) {
    const note =
      u.kind === 'R' ? `along ${fmt(u.angle)}°` : DIRECTION_GLYPH[u.kind] ? DIRECTION_GLYPH[u.kind](u.value) : '';
    html += `<div><dt>${u.label}</dt><dd>${fmt(u.value)} <span class="unit">${u.kind === 'M' ? 'kN·m' : 'kN'}</span> <span class="dir">${note}</span></dd></div>`;
  }
  return `${html}</dl>`;
}

function checkLine(c) {
  return `<h3>Equilibrium check</h3><p class="check ${c.ok ? 'ok' : 'error'}">ΣFx = ${fmt(c.fx)}, ΣFy = ${fmt(c.fy)}, ${c.moments
    .map((m) => `ΣM(${fmt(m.about.x)}, ${fmt(m.about.y)}) = ${fmt(m.value)}`)
    .join(', ')}${c.worstJoint !== undefined ? `<br>Largest unbalanced force at any joint: ${fmt(c.worstJoint)} kN` : ''}</p>`;
}

function renderTrussResults(sol) {
  const tone = sol.status === 'solved' ? (sol.warning ? 'warn' : 'ok') : sol.status === 'incomplete' ? 'info' : 'error';
  let html = `<p class="banner ${tone}">${sol.message}${sol.warning ? `<br>${sol.warning}` : ''}</p>`;

  if (sol.status === 'solved') {
    html += reactionsList(sol);
    html += '<h3>Bar forces</h3><dl class="values">';
    for (const b of sol.bars) {
      html += `<div><dt>${b.label} <span class="dir">${sol.joints[b.a].label}–${sol.joints[b.b].label}</span></dt><dd>${signed(b.force)} <span class="unit">kN</span> <span class="dir">${b.state}</span></dd></div>`;
    }
    html += '</dl><p class="note">Positive is tension, negative is compression. Joints are numbered on the drawing.</p>';
    const zero = sol.bars.filter((b) => b.state === 'zero').map((b) => b.label);
    if (zero.length) html += `<p class="note">Zero-force members: ${zero.join(', ')}.</p>`;
    html += checkLine(sol.check);
  }
  resultsEl.innerHTML = html;
}

function renderResults(sol) {
  if (sol.mode === 'truss') {
    renderTrussResults(sol);
    return;
  }
  const tone =
    sol.status === 'solved' ? (sol.warning ? 'warn' : 'ok') : sol.status === 'incomplete' ? 'info' : 'error';
  let html = `<p class="banner ${tone}">${sol.message}${sol.warning ? `<br>${sol.warning}` : ''}</p>`;

  if (sol.status === 'solved') {
    html += reactionsList(sol);
  }

  const inf = state.internal;
  if (sol.status === 'solved' && inf && inf.status === 'ok') {
    html += '<h3>Internal forces</h3><dl class="values">';
    for (const key of ['N', 'V', 'M']) {
      const { max, min } = inf.summary[key];
      const unit = DIAGRAM_INFO[key].unit;
      const at = (w) => `at (${fmt(w.x)}, ${fmt(w.y)})`;
      if (Math.abs(max.value) < 1e-9 && Math.abs(min.value) < 1e-9) {
        html += `<div><dt>${key}</dt><dd>0 <span class="unit">${unit}</span> <span class="dir">everywhere</span></dd></div>`;
        continue;
      }
      html += `<div><dt>${key} max</dt><dd>${signed(max.value)} <span class="unit">${unit}</span> <span class="dir">${at(max)}</span></dd></div>`;
      html += `<div><dt>${key} min</dt><dd>${signed(min.value)} <span class="unit">${unit}</span> <span class="dir">${at(min)}</span></dd></div>`;
    }
    html += '</dl><p class="note">Use the buttons above the drawing to see the N, V and M diagrams.</p>';
  }

  const resultants = sol.loads.forces.filter((f) => f.kind === 'distributed');
  if (resultants.length) {
    html += '<h3>Distributed load resultants</h3><dl class="values">';
    for (const f of resultants) {
      html += `<div><dt>${f.label}</dt><dd>${fmt(f.total)} <span class="unit">kN</span> <span class="dir">at (${fmt(f.x)}, ${fmt(f.y)})</span></dd></div>`;
    }
    html += '</dl>';
  }

  if (sol.system) {
    const o = sol.system.origin;
    html += `<h3>Equilibrium equations</h3><pre class="eqs">${sol.system.rows
      .map((row) => `${row.name}: ${equationText(row, sol.system.labels)} = 0`)
      .join('\n')}</pre>
      <p class="note">Moments are taken about A at (${fmt(o.x)}, ${fmt(o.y)}). Counterclockwise is positive.</p>`;
  }

  if (sol.check) html += checkLine(sol.check);

  resultsEl.innerHTML = html;
}

/* ---------- tools ---------- */

const HINTS = {
  select: 'Click an item to edit it. Drag to move it. Press Delete to remove it.',
  member: 'Click to start a member, then click to place each joint. Press Esc to finish.',
  pin: 'Click where the pin support goes.',
  roller: 'Click where the roller support goes.',
  fixed: 'Click where the fixed support goes.',
  force: 'Click the point where the force acts.',
  moment: 'Click the point where the moment acts.',
  udl: 'Click the start of the distributed load, then click its end.',
  hinge: 'Click a point on a member to insert a hinge (an internal pin).',
};

function updateHint() {
  if (state.view !== 'fbd') hintEl.textContent = 'Viewing normal forces. Press 1 or pick a tool to go back to editing.'.replace('normal', state.problem.mode === 'truss' ? 'axial' : 'internal');
  else if (state.pending && state.tool === 'member') hintEl.textContent = 'Click the next joint. Press Esc to finish.';
  else if (state.pending && state.tool === 'udl') hintEl.textContent = 'Click the end of the distributed load.';
  else hintEl.textContent = HINTS[state.tool];
}

const TOOLS_BY_MODE = {
  frame: ['select', 'member', 'pin', 'roller', 'fixed', 'force', 'moment', 'udl', 'hinge'],
  truss: ['select', 'member', 'pin', 'roller', 'force'],
};

function setTool(tool) {
  if (!TOOLS_BY_MODE[state.problem.mode].includes(tool)) return;
  state.tool = tool;
  state.view = 'fbd';
  state.pending = null;
  if (tool !== 'select') state.selected = null;
  syncControls();
  notify();
  updateHint();
  refresh();
}

function syncControls() {
  const mode = state.problem.mode;
  if (mode === 'truss' && state.view !== 'fbd' && state.view !== 'N') state.view = 'fbd';
  if (!TOOLS_BY_MODE[mode].includes(state.tool)) state.tool = 'select';
  document.body.dataset.mode = mode;
  document.querySelectorAll('[data-set-mode]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.setMode === mode));
  });
  document.querySelectorAll('[data-tool]').forEach((b) => {
    b.setAttribute('aria-pressed', String(state.view === 'fbd' && b.dataset.tool === state.tool));
  });
  document.querySelectorAll('[data-set-mode]').forEach((b) => {
  b.addEventListener('click', () => setMode(b.dataset.setMode));
});

document.querySelectorAll('[data-view]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.view === state.view));
  });
  svg.setAttribute('class', state.view === 'fbd' ? `tool-${state.tool}` : 'tool-select');
}

function setMode(mode) {
  if (state.problem.mode === mode) return;
  snapshot();
  state.problem.mode = mode;
  state.view = 'fbd';
  state.pending = null;
  notify();
  updateHint();
  refresh();
}

function setView(view) {
  if (state.problem.mode === 'truss' && view !== 'fbd' && view !== 'N') return;
  state.view = view;
  state.pending = null;
  state.hover = null;
  syncControls();
  notify();
  updateHint();
  drawSvg();
}

function addItem(kind, collection, item) {
  snapshot();
  item.id = uid(kind[0]);
  state.problem[collection].push(item);
  return item.id;
}

function placeAt(pt) {
  const { x, y } = pt;
  switch (state.tool) {
    case 'pin':
    case 'roller':
    case 'fixed': {
      const support = { type: state.tool, x, y };
      if (state.tool === 'roller') support.angle = 90;
      state.selected = addItem('support', 'supports', support);
      setTool('select');
      break;
    }
    case 'force':
      state.selected = addItem('force', 'forces', { x, y, magnitude: 10, angle: 270 });
      setTool('select');
      break;
    case 'moment':
      state.selected = addItem('couple', 'moments', { x, y, value: 10 });
      setTool('select');
      break;
    case 'member':
      if (!state.pending) {
        state.pending = { x, y };
      } else if (state.pending.x !== x || state.pending.y !== y) {
        addItem('member', 'members', { x1: state.pending.x, y1: state.pending.y, x2: x, y2: y });
        state.pending = { x, y }; // chain the next member from this joint
      }
      updateHint();
      refresh();
      break;
    case 'hinge':
      state.selected = addItem('hinge', 'hinges', { x, y });
      setTool('select');
      break;
    case 'udl':
      if (!state.pending) {
        state.pending = { x, y };
        updateHint();
        refresh();
      } else {
        state.selected = addItem('wload', 'distributed', {
          x1: state.pending.x,
          y1: state.pending.y,
          x2: x,
          y2: y,
          w: 5,
          angle: 270,
        });
        setTool('select');
      }
      break;
    default:
  }
}

function deleteSelected() {
  if (!state.selected) return;
  snapshot();
  removeItem(state.problem, state.selected);
  state.selected = null;
  refresh();
}

/* ---------- pointer interaction ---------- */

function pointerWorld(e) {
  const pt = svg.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  const p = pt.matrixTransform(svg.getScreenCTM().inverse());
  return toWorld(p.x, p.y);
}

const snapped = (e) => {
  const w = pointerWorld(e);
  return { x: snap(w.x), y: snap(w.y) };
};

svg.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || state.view !== 'fbd') return;
  const pt = snapped(e);

  if (state.tool !== 'select') {
    placeAt(pt);
    return;
  }

  const handle = e.target.closest('[data-handle]');
  const itemEl = e.target.closest('[data-id]');

  if (handle && state.selected) {
    state.drag = { mode: 'handle', index: Number(handle.dataset.handle), last: pt, recorded: false };
  } else if (itemEl) {
    state.selected = itemEl.dataset.id;
    state.drag = { mode: 'move', last: pt, recorded: false };
  } else {
    state.selected = null;
  }
  svg.setPointerCapture(e.pointerId);
  refresh();
});

svg.addEventListener('pointermove', (e) => {
  const pt = snapped(e);
  const drag = state.drag;

  if (drag) {
    const found = findItem(state.problem, state.selected);
    if (!found) return;
    const dx = pt.x - drag.last.x;
    const dy = pt.y - drag.last.y;
    if (dx === 0 && dy === 0) return;
    if (!drag.recorded) {
      snapshot();
      drag.recorded = true;
    }
    const keys = pointKeys(found.kind);
    if (drag.mode === 'handle') {
      const [kx, ky] = keys[drag.index];
      found.item[kx] = pt.x;
      found.item[ky] = pt.y;
    } else {
      for (const [kx, ky] of keys) {
        found.item[kx] += dx;
        found.item[ky] += dy;
      }
    }
    drag.last = pt;
    refresh();
    return;
  }

  if (state.view === 'fbd' && state.tool !== 'select') {
    if (!state.hover || state.hover.x !== pt.x || state.hover.y !== pt.y) {
      state.hover = pt;
      drawSvg();
    }
  }
});

function endDrag(e) {
  if (!state.drag) return;
  state.drag = null;
  if (svg.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);
}
svg.addEventListener('pointerup', endDrag);
svg.addEventListener('pointercancel', endDrag);

svg.addEventListener('pointerleave', () => {
  if (state.hover) {
    state.hover = null;
    drawSvg();
  }
});

svg.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (state.pending) {
    state.pending = null;
    updateHint();
    refresh();
  } else {
    setTool('select');
  }
});

/* ---------- panel editing ---------- */

propsEl.addEventListener('focusin', (e) => {
  if (e.target.matches('input, select')) snapshot();
});

propsEl.addEventListener('input', (e) => {
  const key = e.target.dataset.field;
  const found = state.selected && findItem(state.problem, state.selected);
  if (!key || !found) return;

  let value = e.target.value;
  if (key !== 'type') {
    value = parseFloat(value);
    if (!Number.isFinite(value)) return;
  }
  found.item[key] = value;
  if (key === 'type') {
    if (value === 'roller' && !Number.isFinite(found.item.angle)) found.item.angle = 90;
    if (value !== 'roller') delete found.item.angle;
  }
  refresh({ panel: key === 'type' });
});

propsEl.addEventListener('click', (e) => {
  if (e.target.closest('[data-action="delete"]')) deleteSelected();
});

/* ---------- toolbar, files, keyboard ---------- */

document.querySelectorAll('[data-tool]').forEach((b) => {
  b.addEventListener('click', () => setTool(b.dataset.tool));
});

function setProblem(problem) {
  snapshot();
  state.problem = problem;
  state.selected = null;
  state.pending = null;
  notify();
  updateHint();
  refresh();
}

document.querySelectorAll('[data-view]').forEach((b) => {
  b.addEventListener('click', () => setView(b.dataset.view));
});

undoBtn.addEventListener('click', undo);

$('clear').addEventListener('click', () => {
  setProblem(emptyProblem('Untitled problem', state.problem.mode));
});

$('export').addEventListener('click', () => {
  const slug =
    state.problem.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'fbd-problem';
  const blob = new Blob([JSON.stringify(state.problem, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${slug}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

$('import').addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  fileInput.value = '';
  if (!file) return;
  try {
    setProblem(normalizeProblem(JSON.parse(await file.text())));
  } catch (err) {
    notify(`Could not open ${file.name}: ${err.message}`);
  }
});

examplesEl.addEventListener('change', async () => {
  const file = examplesEl.value;
  if (!file) return;
  try {
    const res = await fetch(`examples/${file}`);
    if (!res.ok) throw new Error(`${file} was not found.`);
    setProblem(normalizeProblem(await res.json()));
  } catch (err) {
    notify(`${err.message} Serve the folder over HTTP (see the README) so examples can load.`);
  }
  examplesEl.value = '';
});

const VIEW_KEYS = { 1: 'fbd', 2: 'N', 3: 'V', 4: 'M' };
const KEYS = { v: 'select', m: 'member', p: 'pin', r: 'roller', f: 'fixed', l: 'force', c: 'moment', d: 'udl', h: 'hinge' };

window.addEventListener('keydown', (e) => {
  if (e.target instanceof Element && e.target.closest('input, select, textarea')) {
    if (e.key === 'Escape') e.target.blur();
    return;
  }
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    undo();
    return;
  }
  if (mod || e.altKey) return;

  if (e.key === 'Escape') {
    if (state.pending) {
      state.pending = null;
      updateHint();
      refresh();
    } else {
      state.selected = null;
      setTool('select');
    }
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    deleteSelected();
  } else if (VIEW_KEYS[e.key]) {
    setView(VIEW_KEYS[e.key]);
  } else if (KEYS[e.key.toLowerCase()]) {
    setTool(KEYS[e.key.toLowerCase()]);
  }
});

/* ---------- start ---------- */

setTool('select');
