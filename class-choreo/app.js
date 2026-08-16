/* ---------- Constants ---------- */
const STORAGE_KEY = 'cc_state_v1';
const TEMPLATES_KEY = 'cc_templates_v1';

const GRID = 24; // px per grid cell — matches the canvas background-size in style.css
const snap = (v) => Math.round(v / GRID) * GRID;

const AREA_SHAPES = {
  table: { label: 'Table (furniture)' },
  area:  { label: 'Area (open floor)' },
};

const AREA_TYPES = {
  teacher: { label: 'Work with Teacher', color: 'var(--type-teacher)', hex: '#4A6FA5' },
  own:     { label: 'Work on Own',       color: 'var(--type-own)',     hex: '#7A8471' },
  leisure: { label: 'Leisure',           color: 'var(--type-leisure)', hex: '#D98E73' },
  group:   { label: 'Group Time',        color: 'var(--type-group)',  hex: '#9B6B9E' },
  custom:  { label: 'Custom',            color: 'var(--type-custom)', hex: '#6B7280' },
};

const CANVAS_W = () => canvasEl.clientWidth;
const CANVAS_H = () => canvasEl.clientHeight;

/* ---------- State ---------- */
let state = loadState() || {
  areas: [],
  students: [],
  groups: [],
  choreo: {}, // studentId -> [{id, areaId, duration}]
};

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

let saveTimer = null;
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    flashSaved();
  }, 250);
}
function flashSaved() {
  const el = document.getElementById('saveIndicator');
  el.textContent = 'All changes saved';
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 500);
}

function genId() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }

/* ---------- Tabs ---------- */
document.getElementById('tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab-btn');
  if (!btn) return;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('panel-' + btn.dataset.tab).classList.add('active');
  if (btn.dataset.tab === 'choreo') refreshChoreoTab();
  if (btn.dataset.tab === 'playback') refreshPlaybackTab();
});

/* =========================================================
   LAYOUT TAB
   ========================================================= */
const canvasEl = document.getElementById('canvas');
const areaEditor = document.getElementById('areaEditor');
let selectedAreaId = null;

function defaultAreaPosition(index) {
  const cascade = index % 6;
  return { x: 24 + cascade * GRID, y: 24 + cascade * GRID };
}

document.getElementById('addAreaBtn').addEventListener('click', () => {
  const pos = defaultAreaPosition(state.areas.length);
  const area = {
    id: genId(),
    x: pos.x, y: pos.y, w: 168, h: 96, // grid-aligned defaults (7x4 cells)
    label: 'New Area',
    type: 'teacher',
    shape: 'table',
    customColor: '#6B7280',
  };
  state.areas.push(area);
  saveState();
  renderAreas();
  selectArea(area.id);
});

function areaColor(area) {
  return area.type === 'custom' ? area.customColor : AREA_TYPES[area.type].hex;
}

function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16), g = parseInt(h.substring(2, 4), 16), b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Applies the "table" (solid, furniture) or "area" (diffuse, open-floor) look
function applyAreaVisualStyle(el, area) {
  const hex = areaColor(area);
  if (area.shape === 'area') {
    el.style.background = hexToRgba(hex, 0.16);
    el.style.borderColor = hexToRgba(hex, 0.6);
    el.style.borderStyle = 'dashed';
    el.style.boxShadow = 'none';
    el.style.color = 'var(--ink)';
  } else {
    el.style.background = hex;
    el.style.borderColor = 'rgba(0,0,0,0.08)';
    el.style.borderStyle = 'solid';
    el.style.boxShadow = '0 1px 2px rgba(0,0,0,0.08)';
    el.style.color = '#fff';
  }
}

function renderAreas() {
  canvasEl.innerHTML = '';
  state.areas.forEach(area => {
    if (!area.shape) area.shape = 'table'; // migrate older saved plans
    const el = document.createElement('div');
    el.className = 'area-block' + (area.id === selectedAreaId ? ' selected' : '');
    el.style.left = area.x + 'px';
    el.style.top = area.y + 'px';
    el.style.width = area.w + 'px';
    el.style.height = area.h + 'px';
    applyAreaVisualStyle(el, area);
    el.dataset.id = area.id;
    el.innerHTML = `${escapeHtml(area.label)}<span class="area-type-label">${AREA_TYPES[area.type].label}</span>
      <div class="resize-handle"></div>`;
    canvasEl.appendChild(el);
    attachAreaDrag(el, area);
  });
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function attachAreaDrag(el, area) {
  el.addEventListener('click', (e) => {
    if (e.target.classList.contains('resize-handle')) return;
    if (didDrag) { didDrag = false; return; }
    selectArea(area.id);
  });

  let didDrag = false;

  // Move
  el.addEventListener('pointerdown', (e) => {
    if (e.target.classList.contains('resize-handle')) return;
    e.stopPropagation();
    const startX = e.clientX, startY = e.clientY;
    const origX = area.x, origY = area.y;
    el.setPointerCapture(e.pointerId);
    el.style.cursor = 'grabbing';

    function onMove(ev) {
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) didDrag = true;
      let nx = clamp(snap(origX + dx), 0, CANVAS_W() - area.w);
      let ny = clamp(snap(origY + dy), 0, CANVAS_H() - area.h);
      area.x = nx; area.y = ny;
      el.style.left = nx + 'px';
      el.style.top = ny + 'px';
    }
    function onUp() {
      el.style.cursor = 'grab';
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      saveState();
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });

  // Resize
  const handle = el.querySelector('.resize-handle');
  handle.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    const startX = e.clientX, startY = e.clientY;
    const origW = area.w, origH = area.h;
    handle.setPointerCapture(e.pointerId);

    function onMove(ev) {
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      let nw = clamp(snap(origW + dx), GRID * 4, CANVAS_W() - area.x);
      let nh = clamp(snap(origH + dy), GRID * 3, CANVAS_H() - area.y);
      area.w = nw; area.h = nh;
      el.style.width = nw + 'px';
      el.style.height = nh + 'px';
    }
    function onUp() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      saveState();
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
}

// clamp v into [min, max]; falls back to min if canvas is smaller than the element
function clamp(v, min, max) {
  if (max < min) return min;
  return Math.max(min, Math.min(max, v));
}

function selectArea(id) {
  selectedAreaId = id;
  renderAreas();
  const area = state.areas.find(a => a.id === id);
  if (!area) {
    areaEditor.innerHTML = `<h3>Area details</h3><p class="empty-note">Select an area on the layout, or add a new one, to edit it here.</p>`;
    return;
  }
  areaEditor.innerHTML = `
    <h3>Area details</h3>
    <div class="field-row">
      <label>Label</label>
      <input type="text" id="editLabel" value="${escapeHtml(area.label)}">
    </div>
    <div class="field-row">
      <label>Type</label>
      <select id="editType">
        ${Object.entries(AREA_TYPES).map(([k, v]) => `<option value="${k}" ${area.type===k?'selected':''}>${v.label}</option>`).join('')}
      </select>
    </div>
    <div class="field-row" id="customColorRow" style="${area.type === 'custom' ? '' : 'display:none'}">
      <label>Color</label>
      <input type="color" id="editColor" value="${area.customColor}">
    </div>
    <div class="field-row">
      <label>Shape</label>
      <select id="editShape">
        ${Object.entries(AREA_SHAPES).map(([k, v]) => `<option value="${k}" ${area.shape===k?'selected':''}>${v.label}</option>`).join('')}
      </select>
      <span class="field-hint">"Area" renders as an open, unfurnished floor space — softer fill, dashed edge.</span>
    </div>
    <button class="btn btn-danger" id="deleteAreaBtn">Delete area</button>
  `;
  document.getElementById('editLabel').addEventListener('input', (e) => {
    area.label = e.target.value || 'Area';
    renderAreas(); saveState();
  });
  document.getElementById('editType').addEventListener('change', (e) => {
    area.type = e.target.value;
    document.getElementById('customColorRow').style.display = area.type === 'custom' ? '' : 'none';
    renderAreas(); saveState();
  });
  document.getElementById('editShape').addEventListener('change', (e) => {
    area.shape = e.target.value;
    renderAreas(); saveState();
  });
  const colorInput = document.getElementById('editColor');
  if (colorInput) colorInput.addEventListener('input', (e) => {
    area.customColor = e.target.value;
    renderAreas(); saveState();
  });
  document.getElementById('deleteAreaBtn').addEventListener('click', () => {
    if (!confirm(`Delete "${area.label}"? Steps referencing it will be removed from every student's plan.`)) return;
    state.areas = state.areas.filter(a => a.id !== id);
    Object.keys(state.choreo).forEach(sid => {
      state.choreo[sid] = state.choreo[sid].filter(s => s.areaId !== id);
    });
    selectedAreaId = null;
    saveState();
    renderAreas();
    areaEditor.innerHTML = `<h3>Area details</h3><p class="empty-note">Select an area on the layout, or add a new one, to edit it here.</p>`;
  });
}

/* =========================================================
   ROSTER TAB
   ========================================================= */
document.getElementById('studentForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const nameInput = document.getElementById('studentName');
  const colorInput = document.getElementById('studentColor');
  const name = nameInput.value.trim();
  if (!name) return;
  state.students.push({ id: genId(), name, color: colorInput.value, initials: initialsOf(name) });
  nameInput.value = '';
  saveState();
  renderStudents();
  renderGroupPicker();
});

function initialsOf(name) {
  return name.trim().split(/\s+/).slice(0, 2).map(p => p[0].toUpperCase()).join('');
}

function renderStudents() {
  const ul = document.getElementById('studentList');
  ul.innerHTML = '';
  if (state.students.length === 0) {
    ul.innerHTML = '<li class="no-steps" style="border:none">No students yet — add your first above.</li>';
    return;
  }
  state.students.forEach(s => {
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="avatar-dot" style="background:${s.color}">${s.initials}</span>
      <span class="row-name">${escapeHtml(s.name)}</span>
      <span class="row-actions"><button class="btn-icon" title="Remove">&times;</button></span>
    `;
    li.querySelector('.btn-icon').addEventListener('click', () => {
      if (!confirm(`Remove ${s.name}? This also deletes their choreography.`)) return;
      state.students = state.students.filter(x => x.id !== s.id);
      state.groups.forEach(g => g.studentIds = g.studentIds.filter(id => id !== s.id));
      delete state.choreo[s.id];
      saveState();
      renderStudents(); renderGroups(); renderGroupPicker();
    });
    ul.appendChild(li);
  });
}

let pickedForNewGroup = new Set();
function renderGroupPicker() {
  const wrap = document.getElementById('groupMemberPicker');
  if (state.students.length === 0) {
    wrap.innerHTML = '<span class="muted" style="margin:0">Add students first to build a group.</span>';
    return;
  }
  wrap.innerHTML = '';
  state.students.forEach(s => {
    const chip = document.createElement('span');
    chip.className = 'group-chip' + (pickedForNewGroup.has(s.id) ? ' checked' : '');
    chip.textContent = s.name;
    chip.addEventListener('click', () => {
      if (pickedForNewGroup.has(s.id)) pickedForNewGroup.delete(s.id);
      else pickedForNewGroup.add(s.id);
      chip.classList.toggle('checked');
    });
    wrap.appendChild(chip);
  });
}

document.getElementById('groupForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const nameInput = document.getElementById('groupName');
  const name = nameInput.value.trim();
  if (!name) return;
  if (pickedForNewGroup.size === 0) { alert('Pick at least one student for this group.'); return; }
  state.groups.push({ id: genId(), name, studentIds: Array.from(pickedForNewGroup) });
  nameInput.value = '';
  pickedForNewGroup = new Set();
  saveState();
  renderGroups(); renderGroupPicker(); populateBulkGroupSelect();
});

function renderGroups() {
  const ul = document.getElementById('groupList');
  ul.innerHTML = '';
  if (state.groups.length === 0) {
    ul.innerHTML = '<li class="no-steps" style="border:none">No groups yet.</li>';
    return;
  }
  state.groups.forEach(g => {
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="row-name">${escapeHtml(g.name)} <span class="muted" style="margin:0">(${g.studentIds.length} students)</span></span>
      <span class="row-actions"><button class="btn-icon" title="Remove">&times;</button></span>
    `;
    li.querySelector('.btn-icon').addEventListener('click', () => {
      state.groups = state.groups.filter(x => x.id !== g.id);
      saveState();
      renderGroups(); populateBulkGroupSelect();
    });
    ul.appendChild(li);
  });
}

/* =========================================================
   CHOREOGRAPHY TAB
   ========================================================= */
let activeStudentId = null;

function refreshChoreoTab() {
  renderChoreoStudentList();
  populateAreaSelect(document.getElementById('stepArea'));
  populateAreaSelect(document.getElementById('bulkArea'));
  populateBulkGroupSelect();
  renderStepsForActiveStudent();
}

function renderChoreoStudentList() {
  const ul = document.getElementById('choreoStudentList');
  ul.innerHTML = '';
  if (state.students.length === 0) {
    ul.innerHTML = '<li class="no-steps" style="border:none">Add students in the Roster tab first.</li>';
    return;
  }
  state.students.forEach(s => {
    const li = document.createElement('li');
    li.className = s.id === activeStudentId ? 'selected' : '';
    const total = totalDuration(s.id);
    li.innerHTML = `<span class="avatar-dot" style="background:${s.color}">${s.initials}</span>
      <span class="row-name">${escapeHtml(s.name)}</span>
      <span class="muted" style="margin:0">${total}min</span>`;
    li.addEventListener('click', () => {
      activeStudentId = s.id;
      renderChoreoStudentList();
      renderStepsForActiveStudent();
    });
    ul.appendChild(li);
  });
}

function totalDuration(studentId) {
  return (state.choreo[studentId] || []).reduce((sum, s) => sum + s.duration, 0);
}

function populateAreaSelect(sel) {
  sel.innerHTML = '';
  if (state.areas.length === 0) {
    sel.innerHTML = '<option value="">No areas yet — add one in Layout</option>';
    return;
  }
  state.areas.forEach(a => {
    const opt = document.createElement('option');
    opt.value = a.id;
    opt.textContent = a.label;
    sel.appendChild(opt);
  });
}

function populateBulkGroupSelect() {
  const sel = document.getElementById('bulkGroup');
  sel.innerHTML = '';
  if (state.groups.length === 0) {
    sel.innerHTML = '<option value="">No groups yet — add one in Roster</option>';
    return;
  }
  state.groups.forEach(g => {
    const opt = document.createElement('option');
    opt.value = g.id;
    opt.textContent = g.name;
    sel.appendChild(opt);
  });
}

document.getElementById('stepForm').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!activeStudentId) return;
  const areaId = document.getElementById('stepArea').value;
  const duration = parseFloat(document.getElementById('stepDuration').value) || 1;
  if (!areaId) { alert('Add an area in the Layout tab first.'); return; }
  if (!state.choreo[activeStudentId]) state.choreo[activeStudentId] = [];
  state.choreo[activeStudentId].push({ id: genId(), areaId, duration });
  saveState();
  renderStepsForActiveStudent();
  renderChoreoStudentList();
});

document.getElementById('bulkForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const groupId = document.getElementById('bulkGroup').value;
  const areaId = document.getElementById('bulkArea').value;
  const duration = parseFloat(document.getElementById('bulkDuration').value) || 1;
  if (!groupId) { alert('Create a group first in the Roster tab.'); return; }
  if (!areaId) { alert('Add an area in the Layout tab first.'); return; }
  const group = state.groups.find(g => g.id === groupId);
  group.studentIds.forEach(sid => {
    if (!state.choreo[sid]) state.choreo[sid] = [];
    state.choreo[sid].push({ id: genId(), areaId, duration });
  });
  saveState();
  renderStepsForActiveStudent();
  renderChoreoStudentList();
});

function renderStepsForActiveStudent() {
  const title = document.getElementById('choreoTitle');
  const form = document.getElementById('stepForm');
  const list = document.getElementById('stepsList');
  const student = state.students.find(s => s.id === activeStudentId);
  if (!student) {
    title.textContent = 'Choose a student';
    form.style.display = 'none';
    list.innerHTML = '';
    return;
  }
  title.textContent = `${student.name}'s plan`;
  form.style.display = 'flex';
  const steps = state.choreo[student.id] || [];
  list.innerHTML = '';
  if (steps.length === 0) {
    list.innerHTML = '<p class="no-steps">No steps yet. Add one above, or use bulk-assign from a group.</p>';
    return;
  }
  let cum = 0;
  steps.forEach((step, idx) => {
    const area = state.areas.find(a => a.id === step.areaId);
    const start = cum;
    cum += step.duration;
    const li = document.createElement('li');
    li.className = 'step-item';
    li.innerHTML = `
      <span class="step-time">${fmtMin(start)}&ndash;${fmtMin(cum)}</span>
      <span class="step-swatch" style="background:${area ? areaColor(area) : '#ccc'}"></span>
      <span class="step-area">${area ? escapeHtml(area.label) : '(deleted area)'}</span>
      <span class="step-duration">${step.duration}min</span>
      <span class="step-actions">
        <button class="btn-icon" data-act="up" title="Move up">&uarr;</button>
        <button class="btn-icon" data-act="down" title="Move down">&darr;</button>
        <button class="btn-icon" data-act="del" title="Delete">&times;</button>
      </span>
    `;
    li.querySelector('[data-act=up]').addEventListener('click', () => moveStep(student.id, idx, -1));
    li.querySelector('[data-act=down]').addEventListener('click', () => moveStep(student.id, idx, 1));
    li.querySelector('[data-act=del]').addEventListener('click', () => {
      state.choreo[student.id].splice(idx, 1);
      saveState(); renderStepsForActiveStudent(); renderChoreoStudentList();
    });
    list.appendChild(li);
  });
}

function moveStep(studentId, idx, dir) {
  const arr = state.choreo[studentId];
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= arr.length) return;
  [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
  saveState();
  renderStepsForActiveStudent();
}

function fmtMin(m) {
  return `${Math.round(m)}m`;
}

/* =========================================================
   PLAYBACK TAB
   ========================================================= */
const playbackCanvas = document.getElementById('playbackCanvas');
const pbAreaLayer = document.getElementById('pbAreaLayer');
const pbAvatarLayer = document.getElementById('pbAvatarLayer');
const scrubber = document.getElementById('scrubber');
const timeDisplay = document.getElementById('timeDisplay');
const AREA_ZONE_HEIGHT = 560; // must match .canvas height in style.css
const DOCK_TOP = AREA_ZONE_HEIGHT + 6;
let simTime = 0; // in minutes
let playing = false;
let playRAF = null;
let lastFrameTs = null;
let avatarEls = {}; // studentId -> persistent DOM element, so CSS transitions can animate moves

function maxTotalMinutes() {
  let max = 0;
  state.students.forEach(s => { max = Math.max(max, totalDuration(s.id)); });
  return max;
}

function refreshPlaybackTab() {
  avatarEls = {}; // drop stale elements (e.g. after loading a template) so they're rebuilt fresh
  renderPlaybackAreas();
  const max = maxTotalMinutes();
  scrubber.max = max || 0;
  simTime = Math.min(simTime, max);
  scrubber.value = simTime;
  updateTimeDisplay(max);
  renderAvatarPositions();
}

function renderPlaybackAreas() {
  pbAreaLayer.innerHTML = '';
  state.areas.forEach(area => {
    const el = document.createElement('div');
    el.className = 'area-block';
    el.style.left = area.x + 'px';
    el.style.top = area.y + 'px';
    el.style.width = area.w + 'px';
    el.style.height = area.h + 'px';
    el.style.cursor = 'default';
    applyAreaVisualStyle(el, area);
    el.innerHTML = `${escapeHtml(area.label)}<span class="area-type-label">${AREA_TYPES[area.type].label}</span>`;
    pbAreaLayer.appendChild(el);
  });
  const dock = document.createElement('div');
  dock.className = 'dock-band';
  pbAreaLayer.appendChild(dock);
  const dockLabel = document.createElement('span');
  dockLabel.className = 'dock-label';
  dockLabel.textContent = 'Not currently placed';
  pbAreaLayer.appendChild(dockLabel);
}

function studentAreaAtTime(studentId, t) {
  const steps = state.choreo[studentId] || [];
  let cum = 0;
  for (const step of steps) {
    const start = cum, end = cum + step.duration;
    if (t >= start && t < end) return step.areaId;
    cum = end;
  }
  if (steps.length && t >= cum) return null; // finished
  return steps.length ? null : null; // nothing scheduled or before start (n/a since starts at 0)
}

function getOrCreateAvatarEl(student) {
  let el = avatarEls[student.id];
  if (el && el.isConnected) return el;
  el = document.createElement('div');
  el.className = 'avatar-token';
  el.style.background = student.color;
  el.textContent = student.initials;
  el.title = student.name;
  pbAvatarLayer.appendChild(el);
  avatarEls[student.id] = el;
  return el;
}

// Persistent elements + left/top updates (rather than remove/recreate) so the
// CSS transition on .avatar-token can visibly slide figures between spots.
function renderAvatarPositions() {
  const byArea = {}; // areaId -> [student]
  const unscheduled = [];

  state.students.forEach(s => {
    const areaId = studentAreaAtTime(s.id, simTime);
    if (areaId && state.areas.find(a => a.id === areaId)) {
      (byArea[areaId] = byArea[areaId] || []).push(s);
    } else {
      unscheduled.push(s);
    }
  });

  const seen = new Set();

  Object.entries(byArea).forEach(([areaId, students]) => {
    const area = state.areas.find(a => a.id === areaId);
    const cols = Math.max(1, Math.floor((area.w - 12) / 30));
    students.forEach((s, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      const el = getOrCreateAvatarEl(s);
      el.style.left = (area.x + 8 + col * 30) + 'px';
      el.style.top = (area.y + 28 + row * 30) + 'px';
      seen.add(s.id);
    });
  });

  const dockWidth = playbackCanvas.clientWidth || 800;
  const perRow = Math.max(1, Math.floor((dockWidth - 24) / 32));
  unscheduled.forEach((s, i) => {
    const col = i % perRow, row = Math.floor(i / perRow);
    const el = getOrCreateAvatarEl(s);
    el.style.left = (12 + col * 32) + 'px';
    el.style.top = (DOCK_TOP + 22 + row * 32) + 'px';
    seen.add(s.id);
  });

  // remove tokens for students that no longer exist
  Object.keys(avatarEls).forEach(id => {
    if (!seen.has(id)) { avatarEls[id].remove(); delete avatarEls[id]; }
  });
}

function updateTimeDisplay(max) {
  timeDisplay.innerHTML = `${fmtClock(simTime)} <span class="of">/ ${fmtClock(max ?? maxTotalMinutes())}</span>`;
}
function fmtClock(mins) {
  const m = Math.floor(mins);
  const s = Math.round((mins - m) * 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

scrubber.addEventListener('pointerdown', () => pbAvatarLayer.classList.add('scrubbing'));
scrubber.addEventListener('pointerup', () => pbAvatarLayer.classList.remove('scrubbing'));
scrubber.addEventListener('input', () => {
  stopPlaying();
  simTime = parseFloat(scrubber.value);
  updateTimeDisplay();
  renderAvatarPositions();
});

document.getElementById('playBtn').addEventListener('click', () => {
  if (playing) stopPlaying();
  else startPlaying();
});
document.getElementById('resetBtn').addEventListener('click', () => {
  stopPlaying();
  simTime = 0;
  scrubber.value = 0;
  updateTimeDisplay();
  renderAvatarPositions();
});

function startPlaying() {
  const max = maxTotalMinutes();
  if (max <= 0) { alert('No choreography yet — add steps in the Choreography tab.'); return; }
  if (simTime >= max) simTime = 0;
  playing = true;
  document.getElementById('playBtn').innerHTML = '&#10074;&#10074; Pause';
  lastFrameTs = null;
  playRAF = requestAnimationFrame(tick);
}
function stopPlaying() {
  playing = false;
  document.getElementById('playBtn').innerHTML = '&#9654; Play';
  if (playRAF) cancelAnimationFrame(playRAF);
  playRAF = null;
}

function tick(ts) {
  if (!playing) return;
  if (lastFrameTs == null) lastFrameTs = ts;
  const deltaMs = ts - lastFrameTs;
  lastFrameTs = ts;
  const msPerMin = parseFloat(document.getElementById('speedSelect').value);
  simTime += deltaMs / msPerMin;
  const max = maxTotalMinutes();
  if (simTime >= max) {
    simTime = max;
    scrubber.value = simTime;
    updateTimeDisplay(max);
    renderAvatarPositions();
    stopPlaying();
    return;
  }
  scrubber.value = simTime;
  updateTimeDisplay(max);
  renderAvatarPositions();
  playRAF = requestAnimationFrame(tick);
}

/* =========================================================
   TEMPLATES TAB
   ========================================================= */
function loadTemplates() {
  try { return JSON.parse(localStorage.getItem(TEMPLATES_KEY)) || {}; }
  catch (e) { return {}; }
}
function saveTemplates(t) { localStorage.setItem(TEMPLATES_KEY, JSON.stringify(t)); }

document.getElementById('saveTemplateBtn').addEventListener('click', () => {
  const name = prompt('Name this template (e.g. "Monday Math Rotation"):');
  if (!name) return;
  const templates = loadTemplates();
  templates[name] = { savedAt: new Date().toISOString(), data: JSON.parse(JSON.stringify(state)) };
  saveTemplates(templates);
  renderTemplates();
});

function renderTemplates() {
  const ul = document.getElementById('templateList');
  const templates = loadTemplates();
  const names = Object.keys(templates);
  ul.innerHTML = '';
  if (names.length === 0) {
    ul.innerHTML = '<li class="no-steps" style="border:none">No saved templates yet.</li>';
    return;
  }
  names.forEach(name => {
    const t = templates[name];
    const li = document.createElement('li');
    const date = new Date(t.savedAt);
    li.innerHTML = `
      <span class="row-name">${escapeHtml(name)} <span class="muted" style="margin:0">${date.toLocaleDateString()}</span></span>
      <span class="row-actions">
        <button class="btn btn-secondary" data-act="load" style="padding:5px 10px;font-size:12px">Load</button>
        <button class="btn-icon" data-act="del" title="Delete">&times;</button>
      </span>
    `;
    li.querySelector('[data-act=load]').addEventListener('click', () => {
      if (!confirm(`Load "${name}"? This replaces your current layout, roster and choreography.`)) return;
      state = JSON.parse(JSON.stringify(t.data));
      saveState();
      renderEverything();
    });
    li.querySelector('[data-act=del]').addEventListener('click', () => {
      if (!confirm(`Delete template "${name}"?`)) return;
      const templates2 = loadTemplates();
      delete templates2[name];
      saveTemplates(templates2);
      renderTemplates();
    });
    ul.appendChild(li);
  });
}

document.getElementById('clearAllBtn').addEventListener('click', () => {
  if (!confirm('Clear the current layout, roster and choreography from this device? Saved templates are kept.')) return;
  state = { areas: [], students: [], groups: [], choreo: {} };
  activeStudentId = null;
  selectedAreaId = null;
  saveState();
  renderEverything();
});

/* =========================================================
   INIT
   ========================================================= */
function renderEverything() {
  renderAreas();
  areaEditor.innerHTML = `<h3>Area details</h3><p class="empty-note">Select an area on the layout, or add a new one, to edit it here.</p>`;
  renderStudents();
  renderGroups();
  renderGroupPicker();
  populateBulkGroupSelect();
  refreshChoreoTab();
  refreshPlaybackTab();
  renderTemplates();
}

window.addEventListener('resize', () => { renderAreas(); if (document.getElementById('panel-playback').classList.contains('active')) renderPlaybackAreas(); });

renderEverything();
