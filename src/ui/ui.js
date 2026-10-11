// DOM menus: title, campaign and briefing (with tactical map), arcade, free flight, hangar and
// profile, settings (graphics, audio, controls with key remapping), pause and results screens.
import { AIRCRAFT } from '../physics/aircraft-data.js';
import { MISSIONS, missionById } from '../game/missions.js';
import { SITES, AIRFIELD, FLEET, VILLAGES, WORLD_HALF } from '../world/layout.js';
import { loadSettings, saveSettings, resetBindings, BINDING_LABELS, DEFAULT_SETTINGS, QUALITY_PRESETS } from '../core/settings.js';
import { displayBindingName } from '../core/input.js';
import { loadProfile, rankFor, isAircraftUnlocked, unlockHint, liveryUnlocked, accuracyPct, saveProfile, RANKS } from '../game/profile.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hex = (n) => '#' + (n >>> 0).toString(16).padStart(6, '0');
const WEATHERS = ['clear', 'overcast', 'rain', 'storm', 'snow'];
const TIMES = ['dawn', 'morning', 'noon', 'afternoon', 'dusk', 'night'];
const GRADE_COL = { S: '#ffd24a', A: '#7dffa1', B: '#7fe8ff', C: '#ffcf5a', D: '#ff9a5a', F: '#ff5050' };

export class UI {
  constructor({ root, game, audio, onStart }) {
    this.root = root;
    this.game = game;
    this.audio = audio;
    this.screen = 'none';
    this.pick = { aircraft: 'f16', livery: null, weather: 'auto', time: 'auto' };
    this.lastConfig = null;
    this.bindWaiting = null;
    root.addEventListener('click', (e) => this.onClick(e));
    root.addEventListener('change', (e) => this.onChange(e));
    root.addEventListener('input', (e) => this.onInput(e));
    window.addEventListener('keydown', (e) => this.onKey(e), true);
    this.hideAll();
  }

  hideAll() { this.root.innerHTML = ''; this.root.style.display = 'none'; this.screen = 'none'; }

  panel(html, cls = '') {
    this.root.style.display = 'flex';
    this.root.innerHTML = `<div class="panel ${cls}">${html}</div>`;
  }

  // ---- Screens --------------------------------------------------------------

  title() {
    this.screen = 'title';
    this.audio.setMusicState && this.audio.setMusicState('menu');
    this.panel(`
      <div class="logo">GIRITEMPS</div>
      <div class="sub">Procedural sky combat · every sound and texture generated at runtime</div>
      <div class="btns">
        <button data-act="campaign">Campaign</button>
        <button data-act="arcade">Arcade</button>
        <button data-act="free">Free flight</button>
        <button data-act="hangar">Hangar &amp; profile</button>
        <button data-act="settings">Settings</button>
      </div>
      <div class="hint">Keyboard · mouse · gamepad. Click the game to capture the mouse. Esc pauses.</div>`, 'center');
  }

  campaign() {
    this.screen = 'campaign';
    const p = loadProfile();
    const cards = MISSIONS.map((m, i) => {
      const prev = i === 0 ? true : !!p.grades[MISSIONS[i - 1].id];
      const grade = p.grades[m.id];
      const locked = !prev;
      return `<div class="card ${locked ? 'locked' : ''}" ${locked ? '' : `data-act="brief" data-id="${m.id}"`}>
        <div class="card-h"><span>${esc(m.name)}</span>
        ${grade ? `<span class="grade" style="color:${GRADE_COL[grade]}">${grade}</span>` : ''}</div>
        <div class="muted">${locked ? 'Locked — complete the previous mission' : esc(m.brief.split('.')[0]) + '.'}</div>
        <div class="muted small">${m.time} · ${m.weather} · par ${Math.round(m.par / 60)} min</div></div>`;
    }).join('');
    this.panel(`<h2>Campaign</h2><div class="grid">${cards}</div>
      <div class="btns"><button data-act="title">Back</button></div>`, 'wide');
  }

  briefing(id) {
    this.screen = 'briefing';
    const m = missionById(id);
    const p = loadProfile();
    if (!this.pick.aircraft || !isAircraftUnlocked(this.pick.aircraft)) this.pick.aircraft = m.aircraft;
    if (!isAircraftUnlocked(this.pick.aircraft)) this.pick.aircraft = 'f16';
    const objs = m.objectives.map((o) => `<li>${esc(o.text)}</li>`).join('');
    this.panel(`
      <h2>${esc(m.name)}</h2>
      <div class="brief-grid">
        <div>
          <p class="brief-text">${esc(m.brief)}</p>
          <h3>Objectives</h3><ol class="objs">${objs}</ol>
          <div class="muted">Environment: ${m.time}, ${m.weather}. Par time ${Math.round(m.par / 60)} min.</div>
          ${this.aircraftPicker()}
          <div class="btns">
            <button data-act="start-campaign" data-id="${m.id}" class="primary">Launch</button>
            <button data-act="speak-brief" data-id="${m.id}">Play briefing voice</button>
            <button data-act="campaign">Back</button>
          </div>
        </div>
        <div><canvas id="map" width="420" height="420"></canvas>
          <div class="muted small">Map: airfield (A), targets, waypoints (W), fleet (F). Red X for enemy positions.</div></div>
      </div>`, 'wide');
    this.drawMap(m);
    void p;
  }

  aircraftPicker() {
    const cards = Object.values(AIRCRAFT).map((spec) => {
      const ok = isAircraftUnlocked(spec.id);
      const sel = this.pick.aircraft === spec.id;
      return `<div class="pick ${sel ? 'sel' : ''} ${ok ? '' : 'locked'}" ${ok ? `data-act="pick-aircraft" data-id="${spec.id}"` : ''}>
        <b>${esc(spec.short || spec.name)}</b><div class="small muted">${esc(spec.role || '')}</div>
        ${ok ? '' : `<div class="small">🔒 ${esc(unlockHint(spec.id))}</div>`}</div>`;
    }).join('');
    const spec = AIRCRAFT[this.pick.aircraft];
    const lv = (spec.liveries || []).map((l) => {
      const ok = liveryUnlocked(spec, l);
      const cur = this.currentLivery(spec);
      return `<option value="${l.id}" ${cur === l.id ? 'selected' : ''} ${ok ? '' : 'disabled'}>${esc(l.name)}${ok ? '' : ` (${l.unlockKills} kills)`}</option>`;
    }).join('');
    return `<h3>Aircraft</h3><div class="picks">${cards}</div>
      <label>Livery <select data-key="livery">${lv}</select></label>`;
  }

  currentLivery(spec) {
    const p = loadProfile();
    const id = p.liveries[spec.id];
    const ok = (spec.liveries || []).find((l) => l.id === id && liveryUnlocked(spec, l));
    return ok ? id : (spec.liveries[0] && spec.liveries[0].id);
  }

  arcade() {
    this.screen = 'arcade';
    const p = loadProfile();
    const rows = p.arcadeHigh.map((e, i) => `<tr><td>${i + 1}</td><td>${e.score}</td><td>${e.wave}</td><td>${e.kills}</td><td>${e.acc}%</td><td>${AIRCRAFT[e.aircraft] ? AIRCRAFT[e.aircraft].short : e.aircraft}</td><td>${e.date}</td></tr>`).join('');
    this.panel(`<h2>Arcade</h2>
      <p class="muted">Endless waves of fighters, with bombers every fourth wave. Score for kills and time alive. One life.</p>
      ${this.aircraftPicker()}
      ${this.envPicker(true)}
      <div class="btns"><button data-act="start-arcade" class="primary">Start</button><button data-act="title">Back</button></div>
      <h3>High scores</h3>
      <table class="tbl"><tr><th>#</th><th>Score</th><th>Wave</th><th>Kills</th><th>Acc</th><th>Aircraft</th><th>Date</th></tr>${rows || '<tr><td colspan="7" class="muted">No runs yet.</td></tr>'}</table>`, 'wide');
  }

  free() {
    this.screen = 'free';
    this.panel(`<h2>Free flight</h2>
      <p class="muted">No enemies. Fly the practice ring course, and score loops and barrel rolls. Pick any aircraft.</p>
      ${this.aircraftPicker()}
      ${this.envPicker(false)}
      <div class="btns"><button data-act="start-free" class="primary">Start</button><button data-act="title">Back</button></div>`, 'wide');
  }

  envPicker(allowAuto) {
    const w = (allowAuto ? ['auto'] : []).concat(WEATHERS).map((x) => `<option ${this.pick.weather === x ? 'selected' : ''}>${x}</option>`).join('');
    const t = (allowAuto ? ['auto'] : []).concat(TIMES).map((x) => `<option ${this.pick.time === x ? 'selected' : ''}>${x}</option>`).join('');
    return `<div class="row"><label>Weather <select data-key="pickWeather">${w}</select></label>
      <label>Time of day <select data-key="pickTime">${t}</select></label></div>`;
  }

  hangar() {
    this.screen = 'hangar';
    const p = loadProfile();
    const rk = rankFor(p.xp);
    const span = rk.next ? rk.next - rk.floor : 1;
    const pct = rk.next ? Math.round(((p.xp - rk.floor) / span) * 100) : 100;
    const ranks = RANKS.map(([min, n]) => `<span class="${p.xp >= min ? 'on' : ''}">${n}</span>`).join(' › ');
    const air = Object.values(AIRCRAFT).map((s) => `<tr><td>${esc(s.short || s.name)}</td><td>${isAircraftUnlocked(s.id) ? '<span style="color:#7dffa1">Unlocked</span>' : esc(unlockHint(s.id))}</td></tr>`).join('');
    const grades = MISSIONS.map((m) => `<tr><td>${esc(m.name)}</td><td style="color:${GRADE_COL[p.grades[m.id]] || '#666'}">${p.grades[m.id] || '—'}</td></tr>`).join('');
    this.panel(`<h2>Hangar &amp; profile</h2>
      <div class="rank"><b>${rk.name}</b> · ${p.xp} XP ${rk.next ? `· next at ${rk.next}` : ''}</div>
      <div class="bar"><div style="width:${pct}%"></div></div>
      <div class="small rankline">${ranks}</div>
      <div class="stats">
        <div><span>Missions</span><b>${p.missionsCompleted}/${MISSIONS.length}</b></div>
        <div><span>S-ranks</span><b>${p.sRanks}</b></div>
        <div><span>Air kills</span><b>${p.kills.air}</b></div>
        <div><span>Ground kills</span><b>${p.kills.ground}</b></div>
        <div><span>Flight time</span><b>${Math.round(p.flightTime / 60)} min</b></div>
        <div><span>Distance</span><b>${Math.round(p.distance / 1000)} km</b></div>
        <div><span>Accuracy</span><b>${accuracyPct(p)}%</b></div>
        <div><span>Best arcade</span><b>${p.arcadeHigh[0] ? p.arcadeHigh[0].score : '—'}</b></div>
      </div>
      <div class="cols"><div><h3>Aircraft</h3><table class="tbl">${air}</table></div>
      <div><h3>Mission grades</h3><table class="tbl">${grades}</table></div></div>
      <div class="btns"><button data-act="reset-profile" class="danger">Reset profile</button><button data-act="title">Back</button></div>`, 'wide');
  }

  settings(tab = 'graphics') {
    this.screen = 'settings';
    const s = loadSettings();
    this.settingsTab = tab;
    const tabs = ['graphics', 'audio', 'controls'].map((t) => `<button data-act="tab" data-id="${t}" class="${t === tab ? 'primary' : ''}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('');
    const check = (key, label) => `<label class="chk"><input type="checkbox" data-key="${key}" ${s[key] ? 'checked' : ''}> ${label}</label>`;
    const range = (key, label, min, max, step, scale = 1) => `<label>${label} <span class="val">${Math.round(s[key] * scale * 100) / 100}</span>
      <input type="range" min="${min}" max="${max}" step="${step}" value="${s[key]}" data-key="${key}" data-range="${scale}"></label>`;
    let body = '';
    if (tab === 'graphics') {
      const q = Object.keys(QUALITY_PRESETS).map((k) => `<option value="${k}" ${s.quality === k ? 'selected' : ''}>${k}</option>`).join('');
      body = `<label>Quality preset <select data-key="quality">${q}</select></label>
        <label>Resolution <select data-key="resolution">${[720, 900, 1080, 1440].map((r) => `<option value="${r}" ${s.resolution === r ? 'selected' : ''}>${r}p</option>`).join('')}</select></label>
        <label>Display <select data-key="displayMode"><option value="windowed" ${s.displayMode === 'windowed' ? 'selected' : ''}>Windowed</option><option value="fullscreen" ${s.displayMode === 'fullscreen' ? 'selected' : ''}>Fullscreen</option></select></label>
        ${range('fov', 'Field of view', 50, 100, 1)}
        ${range('brightness', 'Brightness', 0.6, 1.4, 0.05)}
        ${range('shake', 'Camera shake', 0, 1.5, 0.05)}
        ${check('dynamicRes', 'Dynamic resolution (holds 60 FPS)')}
        ${check('filmGrain', 'Film grain')}
        ${check('vignette', 'Vignette')}
        ${check('motionBlur', 'Motion blur')}
        ${check('godRays', 'God rays')}
        ${check('showFps', 'Show FPS counter')}
        <div class="muted small">Terrain detail, shadows and anti-aliasing follow the preset. Terrain detail changes apply after reloading.</div>`;
    } else if (tab === 'audio') {
      body = [range('masterVol', 'Master', 0, 1, 0.05), range('musicVol', 'Music', 0, 1, 0.05), range('sfxVol', 'Effects', 0, 1, 0.05), range('voiceVol', 'Radio voice', 0, 1, 0.05), range('ambientVol', 'Ambience', 0, 1, 0.05)].join('');
    } else {
      const rows = Object.keys(BINDING_LABELS).map((a) => `<tr><td>${BINDING_LABELS[a]}</td><td><button data-act="bind" data-id="${a}" class="key">${this.bindWaiting === a ? 'press a key…' : esc(displayBindingName(s.bindings[a]))}</button></td><td class="small muted">${esc(s.gamepadBindings[a] || '')}</td></tr>`).join('');
      body = `${range('mouseSens', 'Mouse sensitivity', 0.2, 3, 0.05)}
        ${range('stickSens', 'Stick sensitivity', 0.2, 2, 0.05)}
        ${range('deadzone', 'Gamepad deadzone', 0, 0.3, 0.01)}
        ${check('invertY', 'Invert pitch')}
        <label>Mouse mode <select data-key="mouseMode"><option value="stick" ${s.mouseMode === 'stick' ? 'selected' : ''}>Stick (X roll, Y pitch)</option><option value="aim" ${s.mouseMode === 'aim' ? 'selected' : ''}>Aim (X yaw, Y pitch)</option></select></label>
        <table class="tbl keys"><tr><th>Action</th><th>Keyboard / mouse</th><th>Gamepad</th></tr>${rows}</table>
        <button data-act="reset-bind">Reset key bindings</button>`;
    }
    this.panel(`<h2>Settings</h2><div class="btns">${tabs}</div><div class="set">${body}</div>
      <div class="btns"><button data-act="back-settings">Back</button></div>`, 'wide');
  }

  pause() {
    this.screen = 'pause';
    this.panel(`<h2>Paused</h2><div class="btns center-col">
      <button data-act="resume" class="primary">Resume</button>
      <button data-act="restart">Restart</button>
      <button data-act="settings-pause">Settings</button>
      <button data-act="abort">Abort to menu</button></div>`, 'center');
  }

  results(r) {
    this.screen = 'results';
    const col = GRADE_COL[r.grade] || '#fff';
    const next = r.mode === 'campaign' && r.success ? MISSIONS[MISSIONS.findIndex((m) => m.id === r.missionId) + 1] : null;
    const rankUp = r.rank && r.rank.rankUp ? `<div class="rankup">RANK UP: ${esc(r.rank.rankUp)}</div>` : '';
    this.panel(`<h2>${esc(r.title)}</h2>
      <div class="result"><div class="big" style="color:${col}">${r.grade}</div>
      <div><div class="${r.success ? 'win' : 'lose'}">${r.success ? 'MISSION COMPLETE' : 'MISSION FAILED'}</div>
      <div class="muted">${esc(r.reason || '')}</div></div></div>
      <table class="tbl">
        <tr><td>Time</td><td>${fmtTime(r.time)}</td><td>Score</td><td>${r.score}</td></tr>
        <tr><td>Air kills</td><td>${r.kills.air}</td><td>Ground kills</td><td>${r.kills.ground}</td></tr>
        <tr><td>Accuracy</td><td>${r.accuracy}%</td><td>Hull left</td><td>${r.hpLeft}%</td></tr>
        <tr><td>Missiles fired</td><td>${r.missilesFired}</td><td>XP gained</td><td>+${r.xp}</td></tr>
        ${r.mode === 'arcade' ? `<tr><td>Waves</td><td>${r.wave}</td><td></td><td></td></tr>` : ''}
        ${r.mode === 'free' ? `<tr><td>Rings</td><td>${r.rings}</td><td>Loops / rolls</td><td>${r.loops} / ${r.rolls}</td></tr>` : ''}
      </table>${rankUp}
      <div class="btns">
        ${next ? `<button data-act="brief" data-id="${next.id}" class="primary">Next: ${esc(next.name)}</button>` : ''}
        <button data-act="retry">Retry</button>
        <button data-act="abort">Main menu</button>
      </div>`, 'wide');
    void next;
  }

  loading(msg = 'Generating world…') {
    this.screen = 'loading';
    this.panel(`<div class="logo small-logo">GIRITEMPS</div><div class="muted">${esc(msg)}</div>`, 'center');
  }

  // Tactical map for a mission briefing (world coordinates to canvas).
  drawMap(m) {
    const c = this.root.querySelector('#map');
    if (!c) return;
    const g = c.getContext('2d');
    const S = c.width, half = WORLD_HALF;
    const P = (x, z) => [((x + half) / (2 * half)) * S, ((z + half) / (2 * half)) * S];
    g.fillStyle = '#10261a'; g.fillRect(0, 0, S, S);
    g.strokeStyle = 'rgba(120,200,140,0.15)';
    for (let i = 0; i <= 8; i++) { g.beginPath(); g.moveTo(i * S / 8, 0); g.lineTo(i * S / 8, S); g.moveTo(0, i * S / 8); g.lineTo(S, i * S / 8); g.stroke(); }
    // Sea to the east.
    g.fillStyle = 'rgba(30,80,140,0.6)'; g.fillRect(S * 0.78, 0, S * 0.22, S);
    g.fillStyle = '#7dffa1'; g.font = '13px monospace';
    for (const v of VILLAGES) { const [x, y] = P(v.x, v.z); g.fillRect(x - 2, y - 2, 4, 4); }
    const label = (x, z, t, col = '#ffcf5a') => { const [px, py] = P(x, z); g.fillStyle = col; g.fillText(t, px + 7, py + 4); };
    const [ax, ay] = P(AIRFIELD.x, AIRFIELD.z); g.fillStyle = '#ffffff'; g.fillRect(ax - 4, ay - 4, 8, 8); g.fillText('A', ax + 7, ay + 4);
    const [fx, fy] = P(FLEET.x, FLEET.z); g.fillStyle = '#4c9bff'; g.beginPath(); g.arc(fx, fy, 6, 0, 7); g.fill(); g.fillText('F', fx + 8, fy + 4);
    for (const t of m.targets || []) {
      const site = SITES[t.site]; if (!site) continue;
      const [x, y] = P(site.x, site.z);
      g.strokeStyle = t.objective ? '#ff5050' : '#ff9a5a'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(x - 5, y - 5); g.lineTo(x + 5, y + 5); g.moveTo(x + 5, y - 5); g.lineTo(x - 5, y + 5); g.stroke();
      g.fillStyle = '#ffd0c0'; g.fillText(t.id, x + 8, y + 4);
    }
    for (const o of m.objectives || []) {
      if (o.type === 'waypoints') o.points.forEach((p, i) => { const [x, y] = P(p[0], p[2]); g.strokeStyle = '#ffcf5a'; g.beginPath(); g.arc(x, y, 7, 0, 7); g.stroke(); g.fillStyle = '#ffcf5a'; g.fillText('W' + (i + 1), x + 9, y + 4); });
    }
    if (m.transports) m.transports.route.forEach((p, i) => { const [x, y] = P(p[0], p[2]); g.fillStyle = '#b9c3c9'; g.fillRect(x - 3, y - 3, 6, 6); if (i === 0) g.fillText('T', x + 6, y + 4); });
    if (m.startPos) { const [x, y] = P(m.startPos[0], m.startPos[2]); g.fillStyle = '#7dffa1'; g.beginPath(); g.moveTo(x, y - 7); g.lineTo(x + 6, y + 5); g.lineTo(x - 6, y + 5); g.fill(); }
    void label;
  }

  // ---- Event handling -------------------------------------------------------

  act(name, el) {
    const id = el && el.dataset.id;
    const g = this.game;
    const unlockAudio = () => this.audio.init(loadSettings());
    switch (name) {
      case 'title': return this.title();
      case 'campaign': return this.campaign();
      case 'brief': return this.briefing(id);
      case 'arcade': return this.arcade();
      case 'free': return this.free();
      case 'hangar': return this.hangar();
      case 'settings': return this.settings();
      case 'settings-pause': this.settings(); this.settingsReturn = 'pause'; return;
      case 'tab': return this.settings(id);
      case 'back-settings': {
        if (this.settingsReturn === 'pause') { this.settingsReturn = null; return this.pause(); }
        return this.title();
      }
      case 'pick-aircraft': {
        this.pick.aircraft = id; this.pick.livery = null;
        return this.refresh();
      }
      case 'start-campaign': {
        unlockAudio();
        const m = missionById(id);
        this.lastConfig = { mode: 'campaign', missionId: id, aircraft: this.pick.aircraft, livery: this.liveryFor(this.pick.aircraft) };
        return this.launch();
      }
      case 'speak-brief': {
        unlockAudio();
        const m = missionById(id);
        this.audio.speak(m.brief, { priority: true });
        return;
      }
      case 'start-arcade': {
        unlockAudio();
        this.lastConfig = { mode: 'arcade', aircraft: this.pick.aircraft, livery: this.liveryFor(this.pick.aircraft), ...this.envConfig() };
        return this.launch();
      }
      case 'start-free': {
        unlockAudio();
        this.lastConfig = { mode: 'free', aircraft: this.pick.aircraft, livery: this.liveryFor(this.pick.aircraft), ...this.envConfig() };
        return this.launch();
      }
      case 'resume': g.resume(); return this.hideAll();
      case 'restart': return this.launch();
      case 'retry': return this.launch();
      case 'abort': g.abort(); return this.title();
      case 'reset-profile': {
        if (!confirm('Erase all profile progress, unlocks and high scores?')) return;
        localStorage.removeItem('giritemps.profile.v1');
        location.reload();
        return;
      }
      case 'bind': {
        this.bindWaiting = id; this.settings('controls');
        return;
      }
      case 'reset-bind': { resetBindings(); return this.settings('controls'); }
      default: return;
    }
  }

  envConfig() {
    const pick = (v, list) => (v === 'auto' || !v ? undefined : v);
    return { weather: pick(this.pick.weather), time: pick(this.pick.time) };
  }

  liveryFor(aircraft) {
    const spec = AIRCRAFT[aircraft];
    return this.currentLivery(spec);
  }

  launch() {
    this.loading('Preparing sortie…');
    // Let the loading panel paint before the heavy spawn.
    setTimeout(() => {
      this.hideAll();
      this.game.start(this.lastConfig);
      this.game.resize(window.innerWidth, window.innerHeight);
      this.audio.setMusicState && this.audio.setMusicState('calm');
      this.root.style.display = 'none';
      this.onStart && this.onStart();
    }, 30);
  }

  refresh() {
    const s = this.screen;
    if (s === 'briefing') this.briefing(this.briefId);
    else if (s === 'arcade') this.arcade();
    else if (s === 'free') this.free();
    else if (s === 'hangar') this.hangar();
  }

  onClick(e) {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    if (el.dataset.act === 'brief') this.briefId = el.dataset.id;
    this.act(el.dataset.act, el);
  }

  onChange(e) {
    const el = e.target;
    const key = el.dataset && el.dataset.key;
    if (!key) return;
    if (key === 'livery') {
      const p = loadProfile();
      p.liveries[this.pick.aircraft] = el.value;
      saveProfile();
      return;
    }
    if (key === 'pickWeather') { this.pick.weather = el.value; return; }
    if (key === 'pickTime') { this.pick.time = el.value; return; }
    const s = loadSettings();
    const v = el.type === 'checkbox' ? el.checked : el.type === 'range' ? parseFloat(el.value) : (isNaN(+el.value) ? el.value : +el.value);
    s[key] = v;
    saveSettings();
    if (key === 'displayMode') {
      if (v === 'fullscreen') document.documentElement.requestFullscreen?.().catch(() => {});
      else if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    }
    this.game.applySettings();
    this.audio.setVolumes && this.audio.setVolumes(s);
    if (this.screen === 'settings') this.settings(this.settingsTab || 'graphics');
  }

  onInput(e) {
    const el = e.target;
    if (el.type === 'range' && el.dataset.key) {
      const span = el.parentElement.querySelector('.val');
      if (span) span.textContent = Math.round(parseFloat(el.value) * 100) / 100;
      const s = loadSettings();
      s[el.dataset.key] = parseFloat(el.value);
      saveSettings();
      if (this.audio) this.audio.setVolumes && this.audio.setVolumes(s);
    }
  }

  onKey(e) {
    if (this.bindWaiting) {
      e.preventDefault(); e.stopPropagation();
      const s = loadSettings();
      if (e.code !== 'Escape') s.bindings[this.bindWaiting] = e.code;
      saveSettings();
      this.bindWaiting = null;
      this.settings('controls');
      return;
    }
    if (this.root.style.display === 'none') return;
    if (e.code === 'Escape') {
      if (this.screen === 'pause') { this.game.resume(); this.hideAll(); e.preventDefault(); }
      else if (this.screen === 'campaign' || this.screen === 'arcade' || this.screen === 'free' || this.screen === 'hangar' || this.screen === 'settings') { this.title(); e.preventDefault(); }
      else if (this.screen === 'briefing') { this.campaign(); e.preventDefault(); }
    }
  }

  // Called by the game through the emit hook.
  onGameEvent(ev, data) {
    if (ev === 'pause') { this.pause(); this.root.style.display = 'flex'; }
    if (ev === 'results') { this.results(data); this.root.style.display = 'flex'; }
  }
}

function fmtTime(sec) {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export { DEFAULT_SETTINGS };
