// ---------------------------------------------------------------------------
// HUD — the 2D head-up display.  Drawn into a canvas which is used both as a
// full-screen overlay and as the texture projected on the cockpit combiner
// glass, so what the pilot sees on the glass is exactly this drawing.
// ---------------------------------------------------------------------------
import { clamp, clamp01, lerp } from '../core/Utils.js';
import * as THREE from 'three';

const _leadVec = new THREE.Vector3();
const _projVec = new THREE.Vector3();

const GREEN = '#7dff9b';
const GREEN_DIM = 'rgba(125,255,155,0.45)';
const AMBER = '#ffc247';
const RED = '#ff5a4d';
const CYAN = '#6ce6ff';
const WHITE = '#e9fbff';

export class HUD {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.units = opts.units || 'imperial';
    this.showHelp = false;
    this.helpTimer = 0;
    this.t = 0;
    this.damageFlash = 0;
    this.hitFlash = 0;
    this.hitMarkers = [];
    this.messageStack = [];
    this.lastScore = 0;
    this.scorePop = 0;
    this.radarRange = 20000;
    this.rainDrops = [];
    this.shakeRng = 1;
    this.mfdPage = 0;
  }

  resize(w, h, dpr = 1) {
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.w = this.canvas.width;
    this.h = this.canvas.height;
    this.dpr = dpr;
    this.scale = Math.min(this.w / 1280, this.h / 720);
    if (this.rainDrops.length === 0) this._initRain();
  }

  _initRain() {
    for (let i = 0; i < 90; i++) {
      this.rainDrops.push({
        x: Math.random(), y: Math.random(),
        r: 0.004 + Math.random() * 0.014,
        v: 0.02 + Math.random() * 0.08,
        life: Math.random()
      });
    }
  }

  addHitMarker(x, y, kill) {
    this.hitMarkers.push({ x, y, life: kill ? 0.9 : 0.5, kill: !!kill });
    if (this.hitMarkers.length > 6) this.hitMarkers.shift();
  }

  pushMessage(text, kind = 'info', ttl = 3.5) {
    this.messageStack.unshift({ text, kind, life: ttl, ttl });
    if (this.messageStack.length > 5) this.messageStack.pop();
  }

  update(dt) {
    this.t += dt;
    this.damageFlash = Math.max(0, this.damageFlash - dt * 1.6);
    this.hitFlash = Math.max(0, this.hitFlash - dt * 2.4);
    this.scorePop = Math.max(0, this.scorePop - dt * 2);
    for (const m of this.hitMarkers) m.life -= dt;
    this.hitMarkers = this.hitMarkers.filter((m) => m.life > 0);
    for (const m of this.messageStack) m.life -= dt;
    this.messageStack = this.messageStack.filter((m) => m.life > 0);
  }

  // -----------------------------------------------------------------------
  draw(s, opts = {}) {
    const ctx = this.ctx;
    const w = this.w, h = this.h;
    const glass = !!opts.glass;
    ctx.save();
    ctx.clearRect(0, 0, w, h);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const alpha = glass ? 0.92 : lerp(0.75, 1.0, clamp01(s.hudOpacity !== undefined ? s.hudOpacity : 1));
    ctx.globalAlpha = alpha;
    if (glass) ctx.filter = 'none';

    const S = this.scale * (opts.scale || 1);
    const cx = w * 0.5, cy = h * 0.5;
    const pitchPx = h * 0.030;
    const bank = s.bank || 0;
    const pitch = s.pitch || 0;

    // ---- cockpit glass framing / reticle
    if (s.playerAlive) {
      this._drawPitchLadder(ctx, cx, cy, S, pitch, bank, pitchPx);
      this._drawFlightPath(ctx, cx, cy, S, s);
    }

    this._drawSpeedTape(ctx, w, h, S, s);
    this._drawAltTape(ctx, w, h, S, s);
    this._drawHeadingRibbon(ctx, w, h, S, s);
    this._drawThrottle(ctx, w, h, S, s);
    this._drawGauges(ctx, w, h, S, s);
    this._drawWeaponPanel(ctx, w, h, S, s);
    this._drawRadar(ctx, w, h, S, s);
    this._drawDamageSilhouette(ctx, w, h, S, s);
    this._drawTargetBoxes(ctx, w, h, S, s);
    this._drawLead(ctx, cx, cy, S, s);
    this._drawObjectives(ctx, w, h, S, s);
    this._drawKillFeed(ctx, w, h, S, s);
    this._drawMessages(ctx, w, h, S, s);
    this._drawWarnings(ctx, w, h, S, s);
    this._drawScore(ctx, w, h, S, s);
    this._drawHitMarkers(ctx, w, h, S);
    this._drawEffects(ctx, w, h, S, s);
    if (glass) this._drawRain(ctx, w, h, S, s);
    if (this.showHelp) this._drawHelp(ctx, w, h, S);
    ctx.restore();
  }

  // -----------------------------------------------------------------------
  _setFont(ctx, size, weight = '600', family = 'Menlo, Consolas, monospace') {
    ctx.font = `${weight} ${Math.round(size)}px ${family}`;
  }

  _drawPitchLadder(ctx, cx, cy, S, pitch, bank, pitchPx) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-bank);
    const range = 9;
    ctx.lineWidth = 2 * S;
    ctx.strokeStyle = GREEN;
    ctx.fillStyle = GREEN;
    this._setFont(ctx, 13 * S);
    ctx.textAlign = 'center';
    for (let d = -range * 5; d <= range * 5; d += 5) {
      const y = (pitch * 180 / Math.PI - d) * pitchPx;
      if (Math.abs(y) > this.h * 0.42) continue;
      const major = d % 10 === 0;
      const len = (major ? 120 : 62) * S;
      ctx.globalAlpha = major ? 0.95 : 0.55;
      ctx.beginPath();
      if (d === 0) {
        ctx.moveTo(-170 * S, y); ctx.lineTo(-60 * S, y);
        ctx.moveTo(60 * S, y); ctx.lineTo(170 * S, y);
      } else {
        ctx.moveTo(-len, y); ctx.lineTo(-len * 0.35, y);
        ctx.moveTo(len * 0.35, y); ctx.lineTo(len, y);
      }
      ctx.stroke();
      if (major && d !== 0) {
        ctx.globalAlpha = 0.85;
        ctx.fillText(String(Math.abs(d)), -len - 22 * S, y + 5 * S);
        ctx.fillText(String(Math.abs(d)), len + 22 * S, y + 5 * S);
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    // bank indicator arc
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = GREEN_DIM;
    ctx.lineWidth = 2 * S;
    ctx.beginPath();
    ctx.arc(0, 0, 235 * S, -Math.PI * 0.75, -Math.PI * 0.25);
    ctx.stroke();
    const marks = [-60, -45, -30, -15, 0, 15, 30, 45, 60];
    for (const m of marks) {
      const a = -Math.PI / 2 + m * Math.PI / 180;
      const r0 = 235 * S, r1 = (m === 0 ? 210 : (Math.abs(m) % 30 === 0 ? 220 : 227)) * S;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
      ctx.stroke();
    }
    // pointer
    const pa = -Math.PI / 2 - bank;
    ctx.fillStyle = GREEN;
    ctx.beginPath();
    ctx.moveTo(Math.cos(pa) * 246 * S, Math.sin(pa) * 246 * S);
    ctx.lineTo(Math.cos(pa - 0.045) * 228 * S, Math.sin(pa - 0.045) * 228 * S);
    ctx.lineTo(Math.cos(pa + 0.045) * 228 * S, Math.sin(pa + 0.045) * 228 * S);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  _drawFlightPath(ctx, cx, cy, S, s) {
    // gun cross / boresight
    ctx.strokeStyle = GREEN;
    ctx.lineWidth = 2.4 * S;
    ctx.beginPath();
    ctx.moveTo(cx - 46 * S, cy); ctx.lineTo(cx - 16 * S, cy);
    ctx.moveTo(cx + 16 * S, cy); ctx.lineTo(cx + 46 * S, cy);
    ctx.moveTo(cx, cy - 46 * S); ctx.lineTo(cx, cy - 16 * S);
    ctx.moveTo(cx, cy - 8 * S); ctx.lineTo(cx, cy + 8 * S);
    ctx.stroke();
    // flight path marker (velocity vector)
    const fpmX = cx + clamp(s.sideSlip || 0, -1, 1) * 120 * S;
    const fpmY = cy + clamp((s.aoa || 0) * 0.02, -0.6, 0.6) * 90 * S;
    ctx.strokeStyle = CYAN;
    ctx.lineWidth = 2 * S;
    ctx.beginPath();
    ctx.arc(fpmX, fpmY, 11 * S, 0, Math.PI * 2);
    ctx.moveTo(fpmX - 26 * S, fpmY); ctx.lineTo(fpmX - 11 * S, fpmY);
    ctx.moveTo(fpmX + 11 * S, fpmY); ctx.lineTo(fpmX + 26 * S, fpmY);
    ctx.moveTo(fpmX, fpmY - 11 * S); ctx.lineTo(fpmX, fpmY - 19 * S);
    ctx.stroke();
  }

  _drawSpeedTape(ctx, w, h, S, s) {
    const x = w * 0.115, cy = h * 0.5;
    const kts = s.speedKts || 0;
    const stepVal = 20;
    const pxPerKt = h * 0.0042;
    ctx.save();
    ctx.strokeStyle = GREEN_DIM;
    ctx.lineWidth = 2 * S;
    ctx.fillStyle = GREEN;
    ctx.textAlign = 'right';
    ctx.beginPath();
    ctx.moveTo(x + 78 * S, cy - 150 * S);
    ctx.lineTo(x + 78 * S, cy + 150 * S);
    ctx.stroke();
    const base = Math.round(kts / stepVal) * stepVal;
    for (let i = -8; i <= 8; i++) {
      const v = base + i * stepVal;
      if (v < 0) continue;
      const yy = cy - (v - kts) * pxPerKt;
      if (Math.abs(yy - cy) > 150 * S) continue;
      const major = v % 100 === 0;
      ctx.globalAlpha = major ? 1 : 0.6;
      ctx.beginPath();
      ctx.moveTo(x + 78 * S, yy);
      ctx.lineTo(x + 78 * S - (major ? 20 : 11) * S, yy);
      ctx.stroke();
      if (major) {
        this._setFont(ctx, 15 * S);
        ctx.fillText(String(v), x + 52 * S, yy + 5 * S);
      }
    }
    ctx.globalAlpha = 1;
    // current value box
    ctx.fillStyle = 'rgba(4,22,12,0.72)';
    ctx.strokeStyle = GREEN;
    ctx.lineWidth = 2.2 * S;
    this._roundRect(ctx, x + 82 * S, cy - 20 * S, 132 * S, 40 * S, 5 * S);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = GREEN;
    this._setFont(ctx, 26 * S);
    ctx.textAlign = 'left';
    ctx.fillText(String(Math.round(kts)), x + 92 * S, cy + 10 * S);
    this._setFont(ctx, 12 * S);
    ctx.fillStyle = GREEN_DIM;
    ctx.textAlign = 'right';
    ctx.fillText('KTS', x + 208 * S, cy + 10 * S);
    // mach
    ctx.textAlign = 'right';
    ctx.fillStyle = s.mach > 0.98 ? AMBER : GREEN;
    this._setFont(ctx, 20 * S);
    ctx.fillText(`M ${(s.mach || 0).toFixed(2)}`, x + 208 * S, cy + 46 * S);
    // GS
    this._setFont(ctx, 13 * S);
    ctx.fillStyle = GREEN_DIM;
    ctx.fillText(`GS ${Math.round((s.speed || 0) * 1.94384)}`, x + 208 * S, cy + 66 * S);
    ctx.restore();
  }

  _drawAltTape(ctx, w, h, S, s) {
    const x = w * 0.885, cy = h * 0.5;
    const alt = (s.altitudeFt || 0);
    const stepVal = 200;
    const pxPerFt = h * 0.00042;
    ctx.save();
    ctx.strokeStyle = GREEN_DIM;
    ctx.lineWidth = 2 * S;
    ctx.fillStyle = GREEN;
    ctx.textAlign = 'left';
    ctx.beginPath();
    ctx.moveTo(x - 78 * S, cy - 150 * S);
    ctx.lineTo(x - 78 * S, cy + 150 * S);
    ctx.stroke();
    const base = Math.round(alt / stepVal) * stepVal;
    for (let i = -8; i <= 8; i++) {
      const v = base + i * stepVal;
      const yy = cy - (v - alt) * pxPerFt;
      if (Math.abs(yy - cy) > 150 * S) continue;
      const major = v % 1000 === 0;
      ctx.globalAlpha = major ? 1 : 0.6;
      ctx.beginPath();
      ctx.moveTo(x - 78 * S, yy);
      ctx.lineTo(x - 78 * S + (major ? 20 : 11) * S, yy);
      ctx.stroke();
      if (major) {
        this._setFont(ctx, 15 * S);
        ctx.fillText(String(v), x - 50 * S, yy + 5 * S);
      }
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(4,22,12,0.72)';
    ctx.strokeStyle = GREEN;
    ctx.lineWidth = 2.2 * S;
    this._roundRect(ctx, x - 214 * S, cy - 20 * S, 132 * S, 40 * S, 5 * S);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = GREEN;
    this._setFont(ctx, 24 * S);
    ctx.textAlign = 'right';
    ctx.fillText(String(Math.round(alt)), x - 92 * S, cy + 9 * S);
    this._setFont(ctx, 12 * S);
    ctx.fillStyle = GREEN_DIM;
    ctx.textAlign = 'left';
    ctx.fillText('FT', x - 212 * S, cy + 9 * S);
    // radar altitude + vertical speed
    const agl = (s.agl || 0) * 3.28084;
    ctx.textAlign = 'left';
    ctx.fillStyle = agl < 500 ? AMBER : GREEN;
    this._setFont(ctx, 17 * S);
    ctx.fillText(`R ${Math.round(Math.max(0, agl))}`, x - 190 * S, cy + 46 * S);
    const vs = (s.verticalSpeed || 0) * 196.85;
    ctx.fillStyle = GREEN_DIM;
    this._setFont(ctx, 14 * S);
    ctx.fillText(`${vs >= 0 ? '↑' : '↓'} ${Math.abs(Math.round(vs))}`, x - 190 * S, cy + 66 * S);
    // vertical speed needle
    ctx.save();
    ctx.translate(x - 250 * S, cy);
    ctx.strokeStyle = GREEN_DIM;
    ctx.lineWidth = 2 * S;
    ctx.beginPath(); ctx.arc(0, 0, 40 * S, -Math.PI / 2, Math.PI / 2); ctx.stroke();
    const vsClamped = clamp(vs / 6000, -1, 1) * (Math.PI / 2);
    ctx.strokeStyle = GREEN;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.sin(vsClamped) * 36 * S, -Math.cos(vsClamped) * 0 + -Math.sin(0) * 0);
    ctx.stroke();
    ctx.restore();
    ctx.restore();
  }

  _drawHeadingRibbon(ctx, w, h, S, s) {
    const cx = w * 0.5, y = h * 0.075;
    const hdg = s.heading || 0;
    const pxPerDeg = w * 0.0016;
    ctx.save();
    ctx.strokeStyle = GREEN_DIM;
    ctx.lineWidth = 2 * S;
    ctx.beginPath();
    ctx.moveTo(cx - 330 * S, y + 26 * S);
    ctx.lineTo(cx + 330 * S, y + 26 * S);
    ctx.stroke();
    ctx.textAlign = 'center';
    const base = Math.round(hdg / 5) * 5;
    for (let i = -30; i <= 30; i++) {
      let v = base + i * 5;
      let d = v - hdg;
      if (d > 180) d -= 360;
      if (d < -180) d += 360;
      const x = cx + d * pxPerDeg;
      if (Math.abs(x - cx) > 320 * S) continue;
      const major = ((v % 360) + 360) % 360 % 10 === 0;
      ctx.globalAlpha = major ? 1 : 0.5;
      ctx.beginPath();
      ctx.moveTo(x, y + 26 * S);
      ctx.lineTo(x, y + 26 * S - (major ? 13 : 7) * S);
      ctx.stroke();
      if (major) {
        const label = (((v % 360) + 360) % 360).toString().padStart(3, '0');
        this._setFont(ctx, 14 * S);
        ctx.fillStyle = GREEN;
        ctx.fillText(label, x, y + 48 * S);
      }
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = GREEN;
    ctx.beginPath();
    ctx.moveTo(cx, y + 30 * S);
    ctx.lineTo(cx - 8 * S, y + 14 * S);
    ctx.lineTo(cx + 8 * S, y + 14 * S);
    ctx.closePath();
    ctx.fill();
    // waypoint / target bearing bug
    if (s.waypointBearing !== undefined && s.waypointBearing !== null) {
      let d = s.waypointBearing - hdg;
      if (d > 180) d -= 360;
      if (d < -180) d += 360;
      const x = cx + d * pxPerDeg;
      if (Math.abs(x - cx) < 320 * S) {
        ctx.strokeStyle = CYAN;
        ctx.beginPath();
        ctx.arc(x, y + 34 * S, 6 * S, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  _drawThrottle(ctx, w, h, S, s) {
    const x = w * 0.885, y = h * 0.78;
    const bw = 26 * S, bh = 150 * S;
    ctx.save();
    ctx.strokeStyle = GREEN_DIM;
    ctx.lineWidth = 2 * S;
    ctx.strokeRect(x, y, bw, -bh);
    const t = clamp01(s.throttle || 0);
    ctx.fillStyle = s.ab ? AMBER : GREEN;
    ctx.fillRect(x + 2 * S, y - bh * t, bw - 4 * S, bh * t);
    if (s.ab) {
      ctx.fillStyle = AMBER;
      this._setFont(ctx, 15 * S);
      ctx.textAlign = 'center';
      ctx.fillText('A/B', x + bw * 0.5, y - bh - 12 * S);
    }
    ctx.fillStyle = GREEN;
    this._setFont(ctx, 14 * S);
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.round(t * 100)}%`, x + bw * 0.5, y + 20 * S);
    ctx.fillStyle = GREEN_DIM;
    this._setFont(ctx, 12 * S);
    ctx.fillText('THR', x + bw * 0.5, y + 38 * S);
    // gear/flap/brake status row
    const row = [
      ['GEAR', s.gear ? 'DOWN' : 'UP', s.gear ? AMBER : GREEN_DIM],
      ['FLAP', s.flaps > 0.5 ? 'DN' : 'UP', s.flaps > 0.5 ? AMBER : GREEN_DIM],
      ['BRK', s.airbrake > 0.5 ? 'OPEN' : 'CLOSED', s.airbrake > 0.5 ? AMBER : GREEN_DIM]
    ];
    ctx.textAlign = 'right';
    row.forEach((r, i) => {
      ctx.fillStyle = r[2];
      this._setFont(ctx, 13 * S);
      ctx.fillText(`${r[0]} ${r[1]}`, x + bw + 96 * S, y - bh + 16 * S + i * 20 * S);
    });
    ctx.restore();
  }

  _drawGauges(ctx, w, h, S, s) {
    const x = w * 0.115, y = h * 0.78;
    ctx.save();
    ctx.textAlign = 'left';
    this._setFont(ctx, 13 * S);
    // G meter
    const g = s.gLoad || 1;
    ctx.fillStyle = GREEN_DIM;
    ctx.fillText('G', x - 74 * S, y - 44 * S);
    ctx.fillStyle = Math.abs(g) > 7 ? RED : (Math.abs(g) > 5 ? AMBER : GREEN);
    this._setFont(ctx, 22 * S);
    ctx.fillText(g.toFixed(1), x - 74 * S, y - 20 * S);
    ctx.strokeStyle = GREEN_DIM;
    ctx.lineWidth = 2 * S;
    ctx.beginPath();
    ctx.moveTo(x - 76 * S, y - 8 * S);
    ctx.lineTo(x + 36 * S, y - 8 * S);
    ctx.stroke();
    ctx.fillStyle = Math.abs(g) > 7 ? RED : GREEN;
    const gw = clamp((g + 4) / 16, 0, 1) * 112 * S;
    ctx.fillRect(x - 76 * S, y - 12 * S, gw, 8 * S);
    // AoA
    ctx.fillStyle = GREEN_DIM;
    this._setFont(ctx, 13 * S);
    ctx.fillText('AOA', x - 74 * S, y + 22 * S);
    ctx.fillStyle = s.stall > 0.1 ? RED : GREEN;
    this._setFont(ctx, 19 * S);
    ctx.fillText(`${(s.aoa || 0).toFixed(1)}°`, x - 74 * S, y + 44 * S);
    // fuel
    ctx.fillStyle = GREEN_DIM;
    this._setFont(ctx, 13 * S);
    ctx.fillText('FUEL', x + 24 * S, y + 22 * S);
    const f = clamp01(s.fuel || 0);
    ctx.fillStyle = f < 0.15 ? RED : (f < 0.3 ? AMBER : GREEN);
    this._setFont(ctx, 19 * S);
    ctx.fillText(`${Math.round(f * 100)}%`, x + 24 * S, y + 44 * S);
    ctx.fillStyle = 'rgba(120,255,160,0.25)';
    ctx.fillRect(x + 24 * S, y + 52 * S, 100 * S, 7 * S);
    ctx.fillStyle = f < 0.15 ? RED : GREEN;
    ctx.fillRect(x + 24 * S, y + 52 * S, 100 * S * f, 7 * S);
    ctx.restore();
  }

  _drawWeaponPanel(ctx, w, h, S, s) {
    const x = w - 360 * S, y = h - 250 * S;
    ctx.save();
    ctx.fillStyle = 'rgba(4,22,12,0.55)';
    ctx.strokeStyle = GREEN_DIM;
    ctx.lineWidth = 2 * S;
    this._roundRect(ctx, x, y, 330 * S, 150 * S, 6 * S);
    ctx.fill(); ctx.stroke();
    ctx.textAlign = 'left';
    const weapons = s.weapons || [];
    weapons.forEach((wp, i) => {
      const yy = y + 26 * S + i * 22 * S;
      const selected = s.weapon && s.weapon.name === wp.name;
      ctx.fillStyle = selected ? (wp.count > 0 ? GREEN : RED) : GREEN_DIM;
      this._setFont(ctx, selected ? 16 * S : 14 * S);
      const label = wp.key === 'gun' ? `${wp.name}` : wp.name;
      ctx.fillText(`${selected ? '>' : ' '} ${label}`, x + 12 * S, yy);
      ctx.textAlign = 'right';
      ctx.fillText(wp.key === 'gun' ? `${wp.ammo}` : `${wp.count}`, x + 318 * S, yy);
      ctx.textAlign = 'left';
    });
    ctx.textAlign = 'left';
    ctx.fillStyle = GREEN_DIM;
    this._setFont(ctx, 13 * S);
    ctx.fillText(`FLARE ${s.flares || 0}   CHAFF ${s.chaff || 0}`, x + 12 * S, y + 140 * S);
    // gun heat
    ctx.fillStyle = (s.gunHeat || 0) > 1.6 ? RED : GREEN_DIM;
    ctx.fillRect(x + 240 * S, y + 132 * S, 78 * S, 6 * S);
    ctx.fillStyle = (s.gunHeat || 0) > 1.6 ? RED : AMBER;
    ctx.fillRect(x + 240 * S, y + 132 * S, 78 * S * clamp01((s.gunHeat || 0) / 2.2), 6 * S);
    ctx.restore();
  }

  _drawRadar(ctx, w, h, S, s) {
    const r = 108 * S;
    const cx = 40 * S + r, cy = h - 40 * S - r;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(2,20,10,0.72)';
    ctx.fill();
    ctx.strokeStyle = GREEN_DIM;
    ctx.lineWidth = 2 * S;
    ctx.stroke();
    // rings + cross
    ctx.globalAlpha = 0.4;
    for (const f of [0.33, 0.66]) {
      ctx.beginPath(); ctx.arc(cx, cy, r * f, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy);
    ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r);
    ctx.stroke();
    ctx.globalAlpha = 1;
    // sweep
    const a = (this.t * 1.6) % (Math.PI * 2);
    const grad = ctx.createLinearGradient(cx, cy, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    grad.addColorStop(0, 'rgba(120,255,160,0.35)');
    grad.addColorStop(1, 'rgba(120,255,160,0)');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 3 * S;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    ctx.stroke();
    // contacts (nose up)
    for (const c of (s.radarContacts || [])) {
      const px = cx + c.x * r;
      const py = cy + c.y * r;
      if (Math.hypot(px - cx, py - cy) > r - 3 * S) continue;
      const col = c.ground ? (c.hostile ? AMBER : CYAN) : (c.hostile ? RED : CYAN);
      ctx.fillStyle = col;
      const sz = c.ground ? 2.6 * S : 4.2 * S;
      if (c.ground) {
        ctx.fillRect(px - sz, py - sz, sz * 2, sz * 2);
      } else {
        ctx.beginPath();
        ctx.arc(px, py, sz, 0, Math.PI * 2);
        ctx.fill();
      }
      if (c.locked) {
        ctx.strokeStyle = col;
        ctx.lineWidth = 2 * S;
        ctx.strokeRect(px - 9 * S, py - 9 * S, 18 * S, 18 * S);
      }
    }
    // player
    ctx.fillStyle = GREEN;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 7 * S);
    ctx.lineTo(cx + 6 * S, cy + 7 * S);
    ctx.lineTo(cx - 6 * S, cy + 7 * S);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = GREEN_DIM;
    this._setFont(ctx, 12 * S);
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.round(this.radarRange / 1000)} KM`, cx, cy + r + 20 * S);
    ctx.fillText(s.missionName || '', cx, cy - r - 10 * S);
    ctx.restore();
  }

  _drawDamageSilhouette(ctx, w, h, S, s) {
    const x = w * 0.5 - 300 * S, y = h - 92 * S;
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = GREEN_DIM;
    ctx.lineWidth = 1.6 * S;
    // crude aircraft planform
    ctx.beginPath();
    ctx.moveTo(0, -34 * S); ctx.lineTo(6 * S, -6 * S);
    ctx.lineTo(52 * S, 8 * S); ctx.lineTo(52 * S, 15 * S);
    ctx.lineTo(6 * S, 12 * S); ctx.lineTo(7 * S, 26 * S);
    ctx.lineTo(26 * S, 36 * S); ctx.lineTo(26 * S, 42 * S);
    ctx.lineTo(0, 34 * S);
    ctx.lineTo(-26 * S, 42 * S); ctx.lineTo(-26 * S, 36 * S);
    ctx.lineTo(-7 * S, 26 * S); ctx.lineTo(-6 * S, 12 * S);
    ctx.lineTo(-52 * S, 15 * S); ctx.lineTo(-52 * S, 8 * S);
    ctx.lineTo(-6 * S, -6 * S); ctx.closePath();
    ctx.stroke();
    const dmg = clamp01(s.damaged || 0);
    if (dmg > 0.05) {
      ctx.fillStyle = dmg > 0.6 ? 'rgba(255,90,77,0.45)' : 'rgba(255,194,71,0.35)';
      ctx.fill();
    }
    ctx.fillStyle = dmg > 0.5 ? RED : GREEN_DIM;
    this._setFont(ctx, 12 * S);
    ctx.textAlign = 'left';
    ctx.fillText(`DMG ${Math.round(dmg * 100)}%`, 66 * S, 6 * S);
    ctx.restore();
  }

  _drawTargetBoxes(ctx, w, h, S, s) {
    const cx = w * 0.5, cy = h * 0.5;
    ctx.save();
    // air targets
    for (const b of (s.bandits || [])) {
      const x = cx + b.x * cx;
      const y = cy - b.y * cy;
      const col = b.hostile ? RED : CYAN;
      ctx.strokeStyle = col;
      ctx.lineWidth = (b.locked ? 2.6 : 1.8) * S;
      const sz = clamp(90 * S / (1 + b.dist * 0.0006), 14 * S, 46 * S);
      if (b.onScreen && b.x > -1 && b.x < 1 && b.y > -1 && b.y < 1) {
        if (b.locked) {
          // corner brackets
          const r = sz * 1.6;
          ctx.beginPath();
          for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
            ctx.moveTo(x + sx * r, y + sy * r - sy * r * 0.45);
            ctx.lineTo(x + sx * r, y + sy * r);
            ctx.lineTo(x + sx * r - sx * r * 0.45, y + sy * r);
          }
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.moveTo(x - sz, y - sz); ctx.lineTo(x + sz, y - sz);
          ctx.lineTo(x + sz, y + sz); ctx.lineTo(x - sz, y + sz);
          ctx.closePath();
          ctx.stroke();
        }
        if (b.dist < 4000) {
          ctx.fillStyle = col;
          this._setFont(ctx, 12 * S);
          ctx.textAlign = 'center';
          const alt = '▲';
          ctx.fillText(`${b.name || ''}`, x, y - sz - 22 * S);
          ctx.fillText(`${(b.dist / 1000).toFixed(1)}km`, x, y + sz + 18 * S);
          // relative altitude bar
          const rel = (b.relAlt || 0) / 1000;
          ctx.beginPath();
          ctx.moveTo(x + sz + 8 * S, y);
          ctx.lineTo(x + sz + 8 * S, y - clamp(rel, -1, 1) * 30 * S);
          ctx.stroke();
        }
      } else {
        // off-screen chevron
        this._drawOffscreenMarker(ctx, x, y, cx, cy, col, S, b.hostile ? 1 : 0);
      }
    }
    // ground targets
    for (const g of (s.groundBoxes || [])) {
      const x = cx + g.x * cx, y = cy - g.y * cy;
      if (g.x < -1.05 || g.x > 1.05 || g.y < -1.05 || g.y > 1.05) continue;
      const col = g.hostile ? AMBER : CYAN;
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.6 * S;
      const sz = clamp(70 * S / (1 + g.dist * 0.0004), 10 * S, 30 * S);
      ctx.beginPath();
      ctx.moveTo(x - sz, y); ctx.lineTo(x, y - sz); ctx.lineTo(x + sz, y); ctx.lineTo(x, y + sz);
      ctx.closePath();
      ctx.stroke();
      if (g.dist < 9000) {
        ctx.fillStyle = col;
        this._setFont(ctx, 11 * S);
        ctx.textAlign = 'center';
        ctx.fillText(`${g.label} ${(g.dist / 1000).toFixed(1)}`, x, y + sz + 14 * S);
      }
    }
    ctx.restore();
  }

  _drawOffscreenMarker(ctx, x, y, cx, cy, col, S, kind) {
    const dx = x - cx, dy = y - cy;
    const ang = Math.atan2(dy, dx);
    const r = Math.min(cx, cy) * 0.72;
    const px = cx + Math.cos(ang) * r;
    const py = cy + Math.sin(ang) * r;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(ang);
    ctx.fillStyle = col;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.moveTo(14 * S, 0);
    ctx.lineTo(-8 * S, -9 * S);
    ctx.lineTo(-8 * S, 9 * S);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  _drawLead(ctx, cx, cy, S, s) {
    if (!s.lockTarget || !s.lockTarget.fm || !s.playerAlive) return;
    const ac = s.player;
    if (!ac) return;
    // gun lead indicator: where to aim for the cannon
    const cam = s.cameraRef;
    if (!cam) return;
    const t = s.lockTarget.fm.pos.distanceTo(ac.fm.pos) / 1050;
    const p = _leadVec.copy(s.lockTarget.fm.pos).addScaledVector(s.lockTarget.fm.vel, t);
    p.y += 9.81 * 0.5 * t * t * 0.4;
    const v = _projVec.copy(p).project(cam);
    if (v.z > 1) return;
    const x = cx + v.x * cx;
    const y = cy - v.y * cy;
    ctx.save();
    ctx.strokeStyle = AMBER;
    ctx.lineWidth = 2 * S;
    ctx.beginPath();
    ctx.arc(x, y, 9 * S, 0, Math.PI * 2);
    ctx.moveTo(x - 14 * S, y); ctx.lineTo(x - 9 * S, y);
    ctx.moveTo(x + 9 * S, y); ctx.lineTo(x + 14 * S, y);
    ctx.stroke();
    ctx.restore();
  }

  _drawObjectives(ctx, w, h, S, s) {
    const x = 30 * S, y = h * 0.2;
    ctx.save();
    ctx.textAlign = 'left';
    ctx.fillStyle = GREEN;
    this._setFont(ctx, 17 * S);
    ctx.fillText((s.missionName || '').toUpperCase(), x, y - 24 * S);
    let yy = y;
    for (const o of (s.objectives || [])) {
      const done = o.done;
      const col = done ? 'rgba(125,255,155,0.55)' : (o.optional ? GREEN_DIM : GREEN);
      ctx.fillStyle = col;
      this._setFont(ctx, 14 * S);
      const mark = done ? '✓' : (o.optional ? '○' : '▸');
      ctx.fillText(`${mark} ${o.text}`, x, yy);
      if (o.count > 1) {
        ctx.fillStyle = GREEN_DIM;
        ctx.fillText(`   ${Math.min(o.progress, o.count)}/${o.count}`, x + 18 * S, yy + 16 * S);
        yy += 16 * S;
      }
      if (o.type === 'survive' && !o.done) {
        ctx.fillStyle = GREEN_DIM;
        ctx.fillText(`   ${Math.max(0, o.time - o.timer).toFixed(0)}s`, x + 18 * S, yy + 16 * S);
        yy += 16 * S;
      }
      yy += 22 * S;
      if (done) {
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.4 * S;
        ctx.beginPath();
        ctx.moveTo(x - 4 * S, yy - 20 * S);
        ctx.lineTo(x + ctx.measureText(o.text).width + 12 * S, yy - 20 * S);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  _drawKillFeed(ctx, w, h, S, s) {
    ctx.save();
    ctx.textAlign = 'right';
    let y = h * 0.17;
    for (const k of (s.killFeed || [])) {
      const age = k.age || 0;
      const a = clamp01(1 - age / 8);
      if (a <= 0) continue;
      ctx.globalAlpha = a;
      ctx.fillStyle = k.kind === 'bad' ? RED : (k.kind === 'good' ? GREEN : WHITE);
      this._setFont(ctx, 15 * S);
      ctx.fillText(k.what, w - 30 * S, y);
      if (k.who) {
        ctx.fillStyle = GREEN_DIM;
        this._setFont(ctx, 12 * S);
        ctx.fillText(k.who, w - 30 * S, y + 15 * S);
      }
      y += 34 * S;
    }
    ctx.restore();
  }

  _drawMessages(ctx, w, h, S, s) {
    ctx.save();
    ctx.textAlign = 'right';
    let y = h * 0.62;
    for (const m of this.messageStack) {
      const a = clamp01(m.life / 0.6);
      ctx.globalAlpha = a;
      ctx.fillStyle = m.kind === 'good' ? GREEN : m.kind === 'warn' ? AMBER : m.kind === 'unlock' ? CYAN : WHITE;
      this._setFont(ctx, 16 * S);
      ctx.fillText(m.text, w - 30 * S, y);
      y += 24 * S;
    }
    ctx.globalAlpha = 1;
    // radio subtitles
    if (s.radioMsgs && s.radioMsgs.length) {
      const text = s.radioMsgs[0];
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      this._setFont(ctx, 17 * S, '700');
      const tw = ctx.measureText(text).width;
      ctx.fillRect(w * 0.5 - tw * 0.5 - 14 * S, h * 0.86 - 18 * S, tw + 28 * S, 30 * S);
      ctx.fillStyle = CYAN;
      ctx.fillText(text, w * 0.5, h * 0.86 + 2 * S);
    }
    ctx.restore();
  }

  _drawWarnings(ctx, w, h, S, s) {
    const cx = w * 0.5;
    ctx.save();
    ctx.textAlign = 'center';
    let y = h * 0.68;
    const order = { 3: 0, 2: 1, 1: 2 };
    const list = [...(s.warnings || [])].sort((a, b) => order[a.level] - order[b.level]);
    for (const wr of list) {
      const blink = wr.level >= 2 ? (Math.sin(this.t * 9) > -0.2 ? 1 : 0.25) : 1;
      ctx.globalAlpha = blink;
      if (wr.id === 'missile') {
        ctx.fillStyle = RED;
        this._setFont(ctx, 32 * S, '800');
        ctx.fillText('MISSILE INCOMING', cx, y);
        this._setFont(ctx, 18 * S);
        ctx.fillText(wr.text, cx, y + 26 * S);
        // direction chevrons
        if (wr.bearing !== undefined) {
          const a = (wr.bearing * Math.PI) / 180;
          const r = 150 * S;
          const px = cx + Math.sin(a) * 0;
          ctx.save();
          ctx.translate(cx, y + 70 * S);
          ctx.rotate(a);
          ctx.fillStyle = RED;
          ctx.beginPath();
          ctx.moveTo(0, -r * 0.32);
          ctx.lineTo(-22 * S, r * 0.05);
          ctx.lineTo(22 * S, r * 0.05);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
        y += 96 * S;
      } else {
        const col = wr.level >= 2 ? RED : AMBER;
        ctx.fillStyle = col;
        this._setFont(ctx, wr.level >= 2 ? 28 * S : 20 * S, wr.level >= 2 ? '800' : '700');
        ctx.fillText(wr.text, cx, y);
        y += (wr.level >= 2 ? 40 : 28) * S;
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  _drawScore(ctx, w, h, S, s) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = GREEN_DIM;
    this._setFont(ctx, 14 * S);
    ctx.fillText(`SCORE ${Math.round(s.score || 0)}`, w * 0.5, 26 * S);
    ctx.fillStyle = GREEN;
    this._setFont(ctx, 14 * S);
    const t = s.time || 0;
    const mm = Math.floor(t / 60), ss = Math.floor(t % 60);
    ctx.fillText(`${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}   KILLS ${s.kills || 0}`, w * 0.5, 44 * S);
    ctx.restore();
  }

  _drawHitMarkers(ctx, w, h, S) {
    ctx.save();
    ctx.strokeStyle = WHITE;
    for (const m of this.hitMarkers) {
      const a = clamp01(m.life * 2);
      ctx.globalAlpha = a;
      ctx.lineWidth = (m.kill ? 3.4 : 2.2) * S;
      const r = (m.kill ? 16 : 11) * S;
      const x = w * 0.5 + (m.x || 0), y = h * 0.5 + (m.y || 0);
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        ctx.beginPath();
        ctx.moveTo(x + sx * r, y + sy * r * 0.35);
        ctx.lineTo(x + sx * r, y + sy * r);
        ctx.lineTo(x + sx * r * 0.35, y + sy * r);
        ctx.stroke();
      }
      if (m.kill) {
        ctx.fillStyle = RED;
        this._setFont(ctx, 15 * S, '800');
        ctx.textAlign = 'center';
        ctx.fillText('KILL', x, y - r - 8 * S);
      }
    }
    ctx.restore();
  }

  _drawEffects(ctx, w, h, S, s) {
    // speed lines
    if ((s.speedLines || 0) > 0.02) {
      ctx.save();
      ctx.globalAlpha = clamp01(s.speedLines) * 0.5;
      ctx.strokeStyle = 'rgba(220,245,255,0.5)';
      const cx = w * 0.5, cy = h * 0.5;
      for (let i = 0; i < 26; i++) {
        const a = (i / 26) * Math.PI * 2 + Math.sin(i * 12.9) * 0.3;
        const r0 = Math.min(w, h) * (0.32 + ((i * 7) % 10) * 0.02);
        const r1 = r0 + Math.min(w, h) * 0.22 * clamp01(s.speedLines);
        ctx.lineWidth = (1 + (i % 3)) * S;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
        ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        ctx.stroke();
      }
      ctx.restore();
    }
    // damage vignette
    if (this.damageFlash > 0.01) {
      ctx.save();
      const g = ctx.createRadialGradient(w * 0.5, h * 0.5, Math.min(w, h) * 0.2, w * 0.5, h * 0.5, Math.max(w, h) * 0.7);
      g.addColorStop(0, 'rgba(255,0,0,0)');
      g.addColorStop(1, `rgba(255,30,20,${clamp01(this.damageFlash) * 0.55})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
    // G-effect tunnel vision
    const tunnel = clamp01(s.blackout || 0);
    if (tunnel > 0.02) {
      ctx.save();
      const g = ctx.createRadialGradient(w * 0.5, h * 0.5, Math.min(w, h) * (0.42 - tunnel * 0.32), w * 0.5, h * 0.5, Math.min(w, h) * 0.75);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, `rgba(0,0,0,${clamp01(tunnel * 1.15)})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
    const red = clamp01(s.redout || 0);
    if (red > 0.02) {
      ctx.save();
      const g = ctx.createRadialGradient(w * 0.5, h * 0.5, Math.min(w, h) * (0.46 - red * 0.36), w * 0.5, h * 0.5, Math.min(w, h) * 0.8);
      g.addColorStop(0, 'rgba(120,0,0,0)');
      g.addColorStop(1, `rgba(150,0,0,${clamp01(red * 0.9)})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
  }

  _drawRain(ctx, w, h, S, s) {
    const wet = clamp01(s.canopyRain || 0);
    if (wet <= 0.02) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(200,225,255,0.5)';
    for (const d of this.rainDrops) {
      d.life -= 0.016 * (0.5 + s.speed * 0.001);
      d.y += d.v * (0.4 + (s.speed || 0) * 0.004) * 0.06;
      if (d.y > 1.05) { d.y = -0.05; d.x = Math.random(); d.life = 1; }
      const x = d.x * w, y = d.y * h;
      const r = d.r * Math.min(w, h) * (0.6 + wet * 0.8);
      ctx.globalAlpha = 0.25 + wet * 0.5;
      ctx.lineWidth = 1.4 * S;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.15 + wet * 0.3;
      ctx.beginPath();
      ctx.moveTo(x, y + r);
      ctx.lineTo(x + r * 0.3, y + r * 2.4);
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawHelp(ctx, w, h, S) {
    const lines = [
      'W/S or ↑/↓  PITCH      A/D or ←/→  ROLL      Q/E  RUDDER',
      'SHIFT/CTRL  THROTTLE      TAB  AFTERBURNER      X/Z  MAX/IDLE',
      'SPACE  GUN      F  HEAT SEEKER      R  RADAR MISSILE',
      'G  ROCKETS      B  BOMBS      C  FLARES      V  CHAFF',
      'K  GEAR      L  FLAPS      J  AIRBRAKE      T  CYCLE WEAPON',
      'Y/U  TARGET      C / V  VIEW      ESC  PAUSE'
    ];
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(w * 0.5 - 420 * S, h * 0.2, 840 * S, lines.length * 26 * S + 40 * S);
    ctx.fillStyle = GREEN;
    ctx.textAlign = 'center';
    this._setFont(ctx, 15 * S);
    ctx.fillText('CONTROLS', w * 0.5, h * 0.2 + 28 * S);
    this._setFont(ctx, 14 * S);
    lines.forEach((l, i) => ctx.fillText(l, w * 0.5, h * 0.2 + 56 * S + i * 26 * S));
    ctx.restore();
  }

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
}
