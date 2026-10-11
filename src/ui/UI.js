// ---------------------------------------------------------------------------
// UI — DOM menus: main menu, aircraft/livery select, mission select, briefing,
// debrief with grades, settings (video/audio/controls with rebinding), pause.
// ---------------------------------------------------------------------------
import { AIRCRAFT_SPECS, FLEET_ORDER } from '../aircraft/AircraftModels.js';
import { MISSIONS, QUICK_ACTIONS, UNLOCKS, RANKS } from '../game/Missions.js';
import { QUALITY_PRESETS, DEFAULT_BINDINGS } from '../core/Settings.js';
import { Input } from '../core/Input.js';
import { clamp01, clamp } from '../core/Utils.js';

export class UI {
  constructor(opts) {
    this.root = opts.root;
    this.toastLayer = opts.toast;
    this.settings = opts.settings;
    this.game = opts.game;
    this.audio = opts.audio;
    this.api = opts.api;
    this.open = false;
    this.screen = null;
    this.toasts = [];
    this.selectedAircraft = this.game.save.selectedAircraft || 'viper';
    this.liveryIndex = 0;
    this.settingsTab = 'video';
    this.listeningFor = null;
    this._bindAudioSubscribe();
  }

  _bindAudioSubscribe() {
    // subtitles come from the audio engine
  }

  // -----------------------------------------------------------------------
  showToast(text, kind = 'info', ttl = 3.2) {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    this.toastLayer.appendChild(el);
    setTimeout(() => el.classList.add('fade'), ttl * 1000);
    setTimeout(() => el.remove(), (ttl + 0.8) * 1000);
    while (this.toastLayer.children.length > 7) this.toastLayer.firstChild.remove();
  }

  clear() {
    this.root.innerHTML = '';
    this.open = false;
    this.screen = null;
  }

  _el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  _screen(cls = '') {
    this.root.innerHTML = '';
    const s = this._el('div', `screen ${cls}`);
    this.root.appendChild(s);
    this.open = true;
    return s;
  }

  // -----------------------------------------------------------------------
  showMain() {
    const s = this._screen();
    this.screen = 'main';
    const save = this.game.save;
    const rank = this.game.rank;
    const next = RANKS.find((r) => r.xp > save.xp);
    const tb = this._el('div', 'title-block', `
      <h1>AERIAL <span class="accent">TEMPEST</span></h1>
      <h2>PROCEDURAL AIR COMBAT SIMULATOR</h2>
    `);
    s.appendChild(tb);
    const menu = this._el('div', 'menu');
    const add = (label, sub, fn, disabled) => {
      const b = this._el('button', '', `${label}${sub ? `<small>${sub}</small>` : ''}`);
      if (disabled) b.disabled = true; else b.onclick = () => { this.audio.click('switch'); fn(); };
      menu.appendChild(b);
      return b;
    };
    const campaignDone = MISSIONS.filter((m) => save.missions[m.id]).length;
    add('CAMPAIGN', `${campaignDone}/${MISSIONS.length} MISSIONS COMPLETE`, () => this.showMissions());
    add('INSTANT ACTION', 'ENDLESS WAVES — ARCADE SCORING', () => this.api.startQuick('instant'));
    add('FREE FLIGHT', 'OPEN WORLD — NO THREATS', () => this.api.startQuick('freeflight'));
    add('AEROBATIC COURSE', 'FLY THE RING COURSE', () => this.api.startQuick('aerobatic'));
    add('AIRCRAFT & LOADOUT', `${save.unlocked.length}/${FLEET_ORDER.length} AIRFRAMES`, () => this.showAircraft());
    add('SETTINGS', 'GRAPHICS · AUDIO · CONTROLS', () => this.showSettings());
    add('STATS & RECORDS', 'CAREER SUMMARY', () => this.showStats());
    s.appendChild(menu);
    s.appendChild(this._el('div', 'rankline', `RANK <b>${rank.name}</b> — ${save.xp} XP${next ? ` · ${next.xp - save.xp} XP TO ${next.short}` : ' · MAXIMUM RANK'}`));
    s.appendChild(this._el('div', 'footer-hint', 'CLICK TO CAPTURE MOUSE IN FLIGHT · ESC FOR MENU'));
  }

  showStats() {
    const s = this._screen('wide');
    this.screen = 'stats';
    const save = this.game.save;
    const st = save.stats || {};
    const totalTime = st.time || 0;
    const box = this._el('div', 'scroll');
    box.appendChild(this._el('div', 'title-block', '<h1>CAREER</h1><h2>STATISTICS & RECORDS</h2>'));
    const panel = this._el('div', 'panel');
    const rows = [
      ['RANK', this.game.rank.name],
      ['EXPERIENCE', `${save.xp} XP`],
      ['AIR KILLS', save.kills || 0],
      ['GROUND TARGETS', save.groundKills || 0],
      ['SORTIES', st.flights || 0],
      ['TIME IN THE AIR', `${Math.floor(totalTime / 3600)}h ${Math.floor((totalTime % 3600) / 60)}m`],
      ['AIRCRAFT DESTROYED ON THE GROUND (LOSSES)', save.deaths || 0],
      ['MISSIONS COMPLETE', MISSIONS.filter((m) => save.missions[m.id]).length + ' / ' + MISSIONS.length],
      ['UNLOCKS', save.unlocked.join(', ') || '—']
    ];
    let html = '<table class="stats">';
    for (const [k, v] of rows) html += `<tr><td>${k}</td><td>${v}</td></tr>`;
    html += '</table>';
    panel.innerHTML = html;
    box.appendChild(panel);
    // mission grade table
    const p2 = this._el('div', 'panel');
    p2.style.marginTop = '16px';
    let h2 = '<h3 style="color:var(--amber);letter-spacing:.2em">MISSION RECORDS</h3><table class="stats">';
    for (const m of MISSIONS) {
      const rec = save.missions[m.id];
      h2 += `<tr><td>${m.index}. ${m.name}</td><td>${rec ? `${rec.grade} · ${rec.score}` : '—'}</td></tr>`;
    }
    h2 += '</table>';
    p2.innerHTML = h2;
    box.appendChild(p2);
    s.appendChild(box);
    this._buttons(s, [['BACK', () => this.showMain()]]);
  }

  // -----------------------------------------------------------------------
  showAircraft() {
    const s = this._screen('wide');
    this.screen = 'aircraft';
    s.appendChild(this._el('div', 'title-block', '<h1>HANGAR</h1><h2>SELECT AIRFRAME & LIVERY</h2>'));
    const grid = this._el('div', 'grid3 scroll');
    const save = this.game.save;
    for (const id of FLEET_ORDER) {
      const spec = AIRCRAFT_SPECS[id];
      const unlocked = save.unlocked.includes(id) || id === 'viper' || id === 'raptor';
      const card = this._el('div', `panel ${this.selectedAircraft === id ? 'selected' : ''}`);
      const bars = [
        ['SPEED', clamp01((spec.thrust / spec.mass) / 9)],
        ['TURN', clamp01(spec.rollRate / 4)],
        ['LIFT', clamp01(spec.clMax / 2.2)],
        ['RUGGED', clamp01(spec.fuel / 12000)]
      ];
      let barHtml = '';
      for (const [label, v] of bars) {
        barHtml += `<div class="bar-row"><span>${label}</span><span class="bar"><i style="width:${Math.round(v * 100)}%"></i></span></div>`;
      }
      card.innerHTML = `
        <div class="name">${spec.name}${unlocked ? '' : ' 🔒'}</div>
        <div class="sub">${spec.role} · TIER ${spec.tier} · ${spec.engineCount} × ENGINE</div>
        <div class="sub" style="margin-top:6px;color:#bff3cf">${spec.blurb}</div>
        <div class="sub" style="margin-top:6px">${spec.gun.name} · ${spec.gun.rounds} RDS</div>
        <div class="bars">${barHtml}</div>`;
      const sw = this._el('div', 'swatches');
      spec.liveries.forEach((liv, i) => {
        const isSel = this.selectedAircraft === id && (save.liveries[id] || 0) === i;
        const b = this._el('div', `swatch ${isSel ? 'selected' : ''}`);
        b.style.background = `linear-gradient(135deg, ${liv.base}, ${liv.camo ? liv.camo[0] : liv.base} 60%, ${liv.camo && liv.camo[1] ? liv.camo[1] : liv.base})`;
        b.title = liv.name;
        b.onclick = (ev) => {
          ev.stopPropagation();
          save.liveries[id] = i;
          this.game.persist();
          this.audio.click('switch');
          this.showAircraft();
        };
        sw.appendChild(b);
      });
      card.appendChild(sw);
      card.onclick = () => {
        if (!unlocked) { this.showToast(`${spec.name} — LOCKED`, 'warn'); return; }
        this.selectedAircraft = id;
        save.selectedAircraft = id;
        this.game.persist();
        this.audio.click('switch');
        this.showAircraft();
      };
      if (!unlocked) card.classList.add('locked');
      grid.appendChild(card);
    }
    // unlock progress
    const note = this._el('div', 'panel');
    note.style.marginTop = '16px';
    let html = '<h3 style="color:var(--amber);letter-spacing:.2em">PROGRESSION</h3>';
    for (const u of UNLOCKS) {
      if (u.type !== 'aircraft') continue;
      const has = save.unlocked.includes(u.id);
      const req = u.after ? `COMPLETE MISSION ${MISSIONS.find((m) => m.id === u.after)?.index || '?'}` : `${u.kills} AIR KILLS`;
      html += `<div class="scoreline"><span>${has ? '✓' : '○'} ${u.name}</span><span>${has ? 'UNLOCKED' : req}</span></div>`;
    }
    note.innerHTML = html;
    grid.appendChild(note);
    s.appendChild(grid);
    this._buttons(s, [
      ['BACK', () => this.showMain()],
      ['CUSTOMISE LOADOUT', () => this.showLoadout()]
    ]);
  }

  showLoadout() {
    const s = this._screen();
    this.screen = 'loadout';
    const spec = AIRCRAFT_SPECS[this.selectedAircraft];
    const save = this.game.save;
    s.appendChild(this._el('div', 'title-block', `<h1>LOADOUT</h1><h2>${spec.name}</h2>`));
    const panel = this._el('div', 'panel');
    const l = spec.loadout;
    panel.innerHTML = `
      <div class="kv">
        <b>CANNON</b><span>${spec.gun.name} — ${spec.gun.rounds} rounds</span>
        <b>HEAT SEEKERS</b><span>${l.aim9 || 0} × AIM-9X / R-73</span>
        <b>RADAR MISSILES</b><span>${l.aim120 || 0} × AIM-120D</span>
        <b>ROCKETS</b><span>${(l.rocketPods || 0) * 7} × S-8</span>
        <b>BOMBS</b><span>${l.bombs || 0} × FAB-250</span>
        <b>COUNTERMEASURES</b><span>${l.flares || 0} flares · ${l.chaff || 0} chaff</span>
      </div>
      <div class="spacer"></div>
      <div class="sub" style="color:var(--green-dim);font-size:11.5px">
        SPECIAL WEAPON UNLOCKS ${save.unlocked.includes('aim9x_plus') ? '· AIM-9X BLOCK II (+2)' : ''}${save.unlocked.includes('decoy_pod') ? ' · DECOY POD (+20/+20)' : ''}${save.unlocked.includes('bombs_heavy') ? ' · MK-84 (+2 BOMBS)' : ''}
      </div>`;
    s.appendChild(panel);
    this._buttons(s, [['BACK', () => this.showAircraft()]]);
  }

  // -----------------------------------------------------------------------
  showMissions() {
    const s = this._screen('wide');
    this.screen = 'missions';
    s.appendChild(this._el('div', 'title-block', '<h1>CAMPAIGN</h1><h2>OPERATION AERIAL TEMPEST</h2>'));
    const list = this._el('div', 'list scroll');
    const save = this.game.save;
    MISSIONS.forEach((m, i) => {
      const rec = save.missions[m.id];
      const prev = i === 0 ? { grade: 'A' } : save.missions[MISSIONS[i - 1].id];
      const unlocked = i === 0 || !!prev || !!rec;
      const row = this._el('div', `row ${unlocked ? '' : 'locked'}`);
      row.innerHTML = `
        <div class="idx">${String(m.index).padStart(2, '0')}</div>
        <div>
          <div class="name">${m.name}</div>
          <div class="sub">${m.short} · ${m.location} · ${m.weather.toUpperCase()} · ${specSummary(m)}</div>
        </div>
        <div class="grade-badge">${rec ? rec.grade : (unlocked ? '—' : '🔒')}</div>`;
      row.onclick = () => {
        if (!unlocked) { this.showToast('COMPLETE THE PREVIOUS MISSION FIRST', 'warn'); return; }
        this.audio.click('switch');
        this.showBriefing(m);
      };
      list.appendChild(row);
    });
    s.appendChild(list);
    this._buttons(s, [['BACK', () => this.showMain()]]);
  }

  showBriefing(m) {
    const s = this._screen('wide');
    this.screen = 'briefing';
    const spec = AIRCRAFT_SPECS[this.selectedAircraft || 'viper'];
    const wrap = this._el('div', 'briefing');
    const left = this._el('div', 'panel');
    left.innerHTML = `
      <h3>MISSION ${m.index} — ${m.name}</h3>
      <div class="sub" style="color:var(--green-dim);font-size:11.5px;letter-spacing:.2em;margin-bottom:12px">${m.location} · ${m.short}</div>
      <p>${m.briefing}</p>`;
    const right = this._el('div', 'panel');
    let objHtml = '<h3>OBJECTIVES</h3><ul>';
    for (const o of m.objectives) {
      objHtml += `<li class="obj ${o.optional ? 'optional' : ''}">${o.text}${o.count > 1 ? ` (${o.count})` : ''}${o.optional ? ' — OPTIONAL' : ''}</li>`;
    }
    objHtml += '</ul><div class="spacer"></div><h3>AIRCRAFT</h3><div class="kv">';
    objHtml += `<b>TYPE</b><span>${spec.name}</span>`;
    objHtml += `<b>ROLE</b><span>${spec.role}</span>`;
    objHtml += `<b>CANNON</b><span>${spec.gun.rounds} rds</span>`;
    objHtml += `<b>MISSILES</b><span>${(spec.loadout.aim9 || 0) + (spec.loadout.aim120 || 0)}</span>`;
    objHtml += `<b>WEATHER</b><span>${m.weather.toUpperCase()}</span>`;
    objHtml += `<b>TIME</b><span>${String(Math.floor(m.time)).padStart(2, '0')}:${String(Math.round((m.time % 1) * 60)).padStart(2, '0')}</span>`;
    objHtml += `<b>REWARD</b><span>${m.reward.xp} XP</span></div>`;
    right.innerHTML = objHtml;
    wrap.appendChild(left);
    wrap.appendChild(right);
    s.appendChild(wrap);
    this._buttons(s, [
      ['FLY', () => this.api.startMission(m.id)],
      ['CHANGE AIRCRAFT', () => this.showAircraft()],
      ['BACK', () => this.showMissions()]
    ]);
  }

  showDebrief(res) {
    const s = this._screen('wide');
    this.screen = 'debrief';
    const wrap = this._el('div', 'briefing');
    const left = this._el('div', 'panel centered');
    left.innerHTML = `
      <div class="result-title ${res.success ? 'win' : 'lose'}">${res.success ? 'MISSION COMPLETE' : 'MISSION FAILED'}</div>
      <div class="sub" style="color:var(--green-dim);font-size:11px;letter-spacing:.24em">${res.reason || (res.success ? 'ALL OBJECTIVES ACHIEVED' : 'OBJECTIVES NOT MET')}</div>
      <div class="spacer"></div>
      <div class="grade ${res.grade}">${res.grade}</div>
      <div class="grade-label">RATING</div>
      <div class="spacer"></div>
      <div class="scoreline"><span>FINAL SCORE</span><span>${res.score}</span></div>
      <div class="scoreline"><span>XP EARNED</span><span>+${res.xpGain}</span></div>
      <div class="scoreline"><span>RANK</span><span>${res.rank.name}</span></div>`;
    const right = this._el('div', 'panel');
    const sc = res.scores;
    const st = res.stats;
    const acc = st.fired > 0 ? Math.round((st.hits / st.fired) * 100) : 0;
    let html = `<h3>DEBRIEF</h3>
      <div class="scoreline"><span>AIR KILLS</span><span>${st.airKills}</span></div>
      <div class="scoreline"><span>GROUND TARGETS</span><span>${st.groundKills}</span></div>
      <div class="scoreline"><span>GUN ROUNDS FIRED</span><span>${st.fired}</span></div>
      <div class="scoreline"><span>GUN ACCURACY</span><span>${acc}%</span></div>
      <div class="scoreline"><span>MISSILES FIRED</span><span>${st.missilesFired}</span></div>
      <div class="scoreline"><span>DAMAGE TAKEN</span><span>${Math.round(st.damageTaken)}</span></div>
      <div class="scoreline"><span>FLIGHT TIME</span><span>${formatTime(res.time)}</span></div>
      <div class="spacer"></div>
      <div class="scoreline"><span>COMBAT SCORE</span><span>${Math.round(sc.air + sc.ground + sc.gates)}</span></div>
      <div class="scoreline"><span>BONUSES</span><span>${Math.round(sc.bonus + sc.time)}</span></div>
      <div class="scoreline"><span>PENALTIES</span><span>${Math.round(sc.penalty)}</span></div>
      <div class="spacer"></div><h3>OBJECTIVES</h3>`;
    for (const o of res.objectives) {
      html += `<div class="scoreline"><span>${o.done ? '✓' : '✗'} ${o.text}</span><span>${o.optional ? 'OPTIONAL' : ''}</span></div>`;
    }
    if (res.unlocked && res.unlocked.length) {
      html += `<div class="spacer"></div><h3>UNLOCKED</h3>`;
      for (const u of res.unlocked) html += `<div class="scoreline"><span>${u.name}</span><span>${u.desc}</span></div>`;
    }
    right.innerHTML = html;
    wrap.appendChild(left);
    wrap.appendChild(right);
    s.appendChild(wrap);
    const next = MISSIONS[MISSIONS.findIndex((m) => m.id === this.api.currentMissionId()) + 1];
    this._buttons(s, [
      next && res.success ? ['NEXT MISSION', () => this.showBriefing(next)] : null,
      ['RETRY', () => this.api.restartMission()],
      ['MAIN MENU', () => this.api.quitToMenu()]
    ].filter(Boolean));
  }

  // -----------------------------------------------------------------------
  showSettings(tab) {
    this.settingsTab = tab || this.settingsTab;
    const s = this._screen('wide');
    this.screen = 'settings';
    s.appendChild(this._el('div', 'title-block', '<h1>SETTINGS</h1><h2>SYSTEMS CONFIGURATION</h2>'));
    const wrap = this._el('div', 'settings');
    const tabs = this._el('div', 'tabs');
    for (const [id, label] of [['video', 'VIDEO'], ['audio', 'AUDIO'], ['controls', 'CONTROLS'], ['gameplay', 'GAMEPLAY']]) {
      const t = this._el('div', `tab ${this.settingsTab === id ? 'active' : ''}`, label);
      t.onclick = () => this.showSettings(id);
      tabs.appendChild(t);
    }
    wrap.appendChild(tabs);
    const body = this._el('div', 'panel scroll');
    body.style.maxHeight = '68vh';
    if (this.settingsTab === 'video') this._videoOpts(body);
    else if (this.settingsTab === 'audio') this._audioOpts(body);
    else if (this.settingsTab === 'controls') this._controlOpts(body);
    else this._gameplayOpts(body);
    wrap.appendChild(body);
    s.appendChild(wrap);
    this._buttons(s, [['BACK', () => (this.api.inFlight() ? this.showPause() : this.showMain())]]);
  }

  _row(parent, label, hint, control) {
    const r = this._el('div', 'opt');
    const left = this._el('div', '', `<label>${label}</label>${hint ? `<div class="hint">${hint}</div>` : ''}`);
    r.appendChild(left);
    const right = this._el('div');
    right.appendChild(control);
    r.appendChild(right);
    parent.appendChild(r);
    return r;
  }

  _slider(parent, key, label, hint, min = 0, max = 1, step = 0.01, fmt = (v) => `${Math.round(v * 100)}%`) {
    const wrap = this._el('div');
    const input = document.createElement('input');
    input.type = 'range'; input.min = min; input.max = max; input.step = step;
    input.value = this.settings.get(key, 1);
    const out = this._el('span', '', fmt(parseFloat(input.value)));
    out.style.marginLeft = '10px';
    out.style.fontSize = '11px';
    out.style.color = 'var(--amber)';
    input.oninput = () => {
      const v = parseFloat(input.value);
      this.settings.set(key, v);
      out.textContent = fmt(v);
      this.api.applySettings(key);
    };
    wrap.style.display = 'flex';
    wrap.style.alignItems = 'center';
    wrap.appendChild(input);
    wrap.appendChild(out);
    this._row(parent, label, hint, wrap);
  }

  _toggle(parent, key, label, hint, def = true) {
    const t = this._el('div', `toggle ${this.settings.get(key, def) ? 'on' : ''}`);
    t.appendChild(this._el('i'));
    t.onclick = () => {
      const v = !this.settings.get(key, def);
      this.settings.set(key, v);
      t.classList.toggle('on', v);
      this.api.applySettings(key);
    };
    this._row(parent, label, hint, t);
  }

  _select(parent, key, label, hint, options, map = (v) => v) {
    const sel = document.createElement('select');
    options.forEach(([v, l]) => {
      const o = document.createElement('option');
      o.value = String(v); o.textContent = l;
      if (String(this.settings.get(key, v)) === String(v)) o.selected = true;
      sel.appendChild(o);
    });
    sel.onchange = () => {
      this.settings.set(key, map(sel.value));
      this.api.applySettings(key);
    };
    this._row(parent, label, hint, sel);
  }

  _videoOpts(body) {
    const q = this._el('div');
    q.style.display = 'flex';
    q.style.gap = '8px';
    for (let i = 0; i <= 3; i++) {
      const b = this._el('div', `tab ${this.settings.data.quality === i ? 'active' : ''}`, QUALITY_PRESETS[i].name);
      b.onclick = () => { this.settings.applyPreset(i); this.api.applySettings('quality'); this.showSettings('video'); };
      q.appendChild(b);
    }
    this._row(body, 'QUALITY PRESET', 'Scales shadows, clouds, particles and view distance', q);
    this._toggle(body, 'dynamicResolution', 'DYNAMIC RESOLUTION', 'Drop resolution briefly to hold frame rate');
    this._toggle(body, 'postFX', 'POST PROCESSING', 'Bloom, grading, vignette, grain');
    this._toggle(body, 'bloom', 'BLOOM / HDR', 'Sun, exhaust and explosion glow');
    this._toggle(body, 'motionBlur', 'MOTION BLUR', 'Camera + speed blur');
    this._toggle(body, 'chromatic', 'CHROMATIC ABERRATION', 'Lens colour fringing');
    this._toggle(body, 'filmGrain', 'FILM GRAIN', 'Sensor noise');
    this._toggle(body, 'vignette', 'VIGNETTE', 'Darkened corners');
    this._toggle(body, 'depthOfField', 'DEPTH OF FIELD', 'Defocus the cockpit frame at distance');
    this._toggle(body, 'speedLines', 'SPEED LINES', 'High-speed motion streaks');
    this._toggle(body, 'godRays', 'GOD RAYS', 'Volumetric light through cloud gaps');
    this._select(body, 'antiAliasing', 'ANTI-ALIASING', 'FXAA is cheap, MSAA is sharper',
      [[0, 'OFF'], [1, 'FXAA'], [2, 'FXAA + HIGH'], [3, 'MSAA 4x']], (v) => parseInt(v, 10));
    this._slider(body, 'fov', 'FIELD OF VIEW', 'Cockpit default is 72°', 50, 110, 1, (v) => `${Math.round(v)}°`);
    this._slider(body, 'renderScale', 'RENDER SCALE', 'Supersample above 100% for a sharper image', 0.5, 1.5, 0.05, (v) => `${Math.round(v * 100)}%`);
  }

  _audioOpts(body) {
    this._slider(body, 'masterVolume', 'MASTER VOLUME');
    this._slider(body, 'musicVolume', 'MUSIC', 'Adaptive procedural score');
    this._slider(body, 'sfxVolume', 'EFFECTS', 'Engines, guns, explosions');
    this._slider(body, 'voiceVolume', 'RADIO & VOICE', 'Wingman callouts and briefings');
    this._slider(body, 'cockpitVolume', 'COCKPIT', 'Warnings, hydraulics, tones');
    this._toggle(body, 'subtitles', 'SUBTITLES', 'Show radio text on screen');
  }

  _controlOpts(body) {
    const info = this._el('div', '', `<div class="hint" style="margin-bottom:10px">Click a binding, then press the new key. Mouse and gamepad are always active.</div>`);
    body.appendChild(info);
    const list = this.settings.data.bindings || DEFAULT_BINDINGS;
    for (const action of Object.keys(DEFAULT_BINDINGS)) {
      const wrap = this._el('div');
      wrap.style.display = 'flex';
      wrap.style.gap = '6px';
      wrap.style.flexWrap = 'wrap';
      const keys = list[action] || [];
      keys.forEach((k, i) => {
        const b = this._el('div', `keybind ${this.listeningFor === action + ':' + i ? 'listening' : ''}`, prettyKey(k));
        b.onclick = () => this._listen(action, i);
        wrap.appendChild(b);
      });
      const add = this._el('div', 'keybind', '+');
      add.onclick = () => { list[action] = list[action] || []; list[action].push('KeyP'); this.settings.save(); this.api.applySettings('bindings'); this.showSettings('controls'); };
      wrap.appendChild(add);
      this._row(body, action.replace(/([A-Z])/g, ' $1').toUpperCase(), '', wrap);
    }
    this._slider(body, 'mouseSensitivity', 'MOUSE SENSITIVITY', '', 0.1, 4, 0.05, (v) => v.toFixed(2));
    this._slider(body, 'gamepadSensitivity', 'GAMEPAD SENSITIVITY', '', 0.1, 3, 0.05, (v) => v.toFixed(2));
    this._slider(body, 'deadzone', 'GAMEPAD DEADZONE', '', 0, 0.4, 0.01, (v) => v.toFixed(2));
    this._toggle(body, 'invertPitch', 'INVERT PITCH', 'Wheel-style: pull back to climb (default on for sticks)');
    this._toggle(body, 'invertYaw', 'INVERT YAW', '');
  }

  _gameplayOpts(body) {
    this._toggle(body, 'cockpitShake', 'COCKPIT SHAKE', 'Buffet, gun fire and touchdown bumps');
    this._slider(body, 'hudOpacity', 'HUD OPACITY', '', 0.3, 1, 0.05);
    this._toggle(body, 'flightAssist', 'FLIGHT ASSIST', 'Bank auto-levelling and stall protection');
    this._select(body, 'units', 'UNITS', 'Displayed on the HUD', [['imperial', 'IMPERIAL (KTS / FT)'], ['metric', 'METRIC (KM/H / M)']]);
    this._toggle(body, 'showDamage', 'DAMAGE SILHOUETTE', '');
    const b = this._el('div', 'btn danger small', 'RESET ALL SETTINGS');
    b.style.marginTop = '16px';
    b.onclick = () => this.settings.resetAll();
    body.appendChild(b);
  }

  _listen(action, index) {
    this.listeningFor = `${action}:${index}`;
    this.showSettings('controls');
    const handler = (e) => {
      e.preventDefault();
      const list = this.settings.data.bindings;
      list[action] = list[action] || [];
      list[action][index] = e.code;
      this.listeningFor = null;
      this.settings.save();
      this.api.applySettings('bindings');
      window.removeEventListener('keydown', handler, true);
      this.showSettings('controls');
    };
    window.addEventListener('keydown', handler, true);
  }

  // -----------------------------------------------------------------------
  showPause() {
    const s = this._screen();
    this.screen = 'pause';
    s.appendChild(this._el('div', 'title-block', '<h1>PAUSED</h1><h2>MISSION ON HOLD</h2>'));
    const wrap = this._el('div', 'pause-wrap');
    const add = (label, fn) => {
      const b = this._el('button', '', label);
      b.onclick = () => { this.audio.click('switch'); fn(); };
      wrap.appendChild(b);
    };
    add('RESUME FLIGHT', () => this.api.resume());
    add('RESTART MISSION', () => this.api.restartMission());
    add('SETTINGS', () => this.showSettings());
    add('CONTROLS', () => this.showControls());
    add('QUIT TO MENU', () => this.api.quitToMenu());
    s.appendChild(wrap);
    s.appendChild(this._el('div', 'rankline', `SCORE <b>${Math.round(this.game.score)}</b> · KILLS <b>${this.game.stats.airKills}</b>`));
  }

  showControls() {
    const s = this._screen('wide');
    this.screen = 'controls';
    s.appendChild(this._el('div', 'title-block', '<h1>CONTROLS</h1><h2>KEYBOARD · MOUSE · GAMEPAD</h2>'));
    const panel = this._el('div', 'panel scroll');
    const rows = [
      ['PITCH', 'W / S or ↑ / ↓  (gamepad right stick)'],
      ['ROLL', 'A / D or ← / →  (gamepad right stick X)'],
      ['RUDDER', 'Q / E  (gamepad left stick X)'],
      ['THROTTLE', 'SHIFT / CTRL · X = full · Z = idle'],
      ['AFTERBURNER', 'TAB (hold at full throttle)'],
      ['CANNON', 'SPACE'],
      ['HEAT SEEKER', 'F'],
      ['RADAR MISSILE', 'R (requires a radar lock)'],
      ['ROCKETS', 'G'],
      ['BOMBS', 'B'],
      ['FLARES', 'C'],
      ['CHAFF', 'V'],
      ['CYCLE WEAPON', 'T'],
      ['NEXT / PREV TARGET', 'Y / U'],
      ['GEAR', 'K'],
      ['FLAPS', 'L'],
      ['AIRBRAKE', 'J'],
      ['CAMERA', '1 / 2 / 3 / 4 (cockpit, chase, orbit, flyby)'],
      ['REAR VIEW', 'H'],
      ['NIGHT VISION', 'N'],
      ['HELP OVERLAY', 'F1'],
      ['PAUSE', 'ESC']
    ];
    let html = '<table class="stats">';
    for (const [k, v] of rows) html += `<tr><td style="color:var(--green-dim)">${k}</td><td>${v}</td></tr>`;
    html += '</table>';
    panel.innerHTML = html;
    s.appendChild(panel);
    this._buttons(s, [['BACK', () => (this.api.inFlight() ? this.showPause() : this.showMain())]]);
  }

  _buttons(s, list) {
    const row = this._el('div', 'btn-row');
    row.style.marginTop = '20px';
    for (const [label, fn] of list) {
      const b = this._el('button', label === 'FLY' || label.includes('NEXT') ? 'btn primary' : 'btn small', label);
      b.onclick = () => { this.audio.click('switch'); fn(); };
      row.appendChild(b);
    }
    s.appendChild(row);
  }
}

function specSummary(m) {
  const parts = [];
  if (m.spawns) {
    for (const s of m.spawns) parts.push(`${s.count} × ${s.aircraft.toUpperCase()}`);
  }
  if (m.ground) {
    for (const k of Object.keys(m.ground)) if (k !== 'center' && k !== 'spread') parts.push(`${m.ground[k]} × ${k.toUpperCase()}`);
  }
  return parts.slice(0, 3).join(' · ') || 'CLEAN';
}

function prettyKey(code) {
  if (!code) return '—';
  return code
    .replace('Key', '').replace('Digit', '').replace('Arrow', '')
    .replace('Left', ' L').replace('Right', ' R')
    .replace('Control', 'CTRL').replace('Shift', 'SHIFT').replace('Space', 'SPACE')
    .replace('Tab', 'TAB').replace('Escape', 'ESC').toUpperCase();
}

function formatTime(t) {
  const mm = Math.floor(t / 60), ss = Math.floor(t % 60);
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}
