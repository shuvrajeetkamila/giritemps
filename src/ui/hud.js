// Head-up display drawn on a 2D canvas overlay every frame: flight instruments, pitch ladder,
// weapons, lock brackets, target info, damage silhouette, G meter, radar, warnings and popups.
const GREEN = '#7dffa1';
const AMBER = '#ffcf5a';
const RED = '#ff5050';
const CYAN = '#7fe8ff';

export class HUD {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.popups = [];
    this.flash = 0;
    this.dropSeed = 1;
    this.drops = [];
    for (let i = 0; i < 90; i++) this.drops.push({ x: Math.random(), y: Math.random(), r: 2 + Math.random() * 6, v: 0.02 + Math.random() * 0.08 });
  }

  resize(w, h, dpr = 1) {
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w; this.h = h;
  }

  popup(text, color = GREEN, life = 2.2) { this.popups.push({ text, color, life, max: life }); }

  draw(s, dt) {
    const g = this.g, w = this.w, h = this.h;
    g.clearRect(0, 0, w, h);
    g.font = '14px "Courier New", monospace';
    g.textBaseline = 'middle';
    // Cockpit glass: rain droplets and frost when applicable.
    if (s.cockpit) this.drawGlass(s, dt);
    if (s.hudVisible === false) { this.drawPopups(dt); return; }
    const cx = w / 2, cy = h / 2;
    this.flash = Math.max(0, this.flash - dt);
    g.strokeStyle = GREEN; g.fillStyle = GREEN; g.lineWidth = 1.5;

    // Pitch ladder (rotates with bank, shifts with pitch).
    const pxPerDeg = h / 40;
    g.save();
    g.translate(cx, cy);
    g.rotate(-s.rollDeg * Math.PI / 180);
    g.globalAlpha = 0.85;
    for (let d = -30; d <= 30; d += 5) {
      if (d === 0) continue;
      const y = d * pxPerDeg + s.pitchDeg * pxPerDeg;
      const hw = d % 10 === 0 ? 60 : 30;
      g.beginPath(); g.moveTo(-hw, y); g.lineTo(hw, y); g.stroke();
      if (d % 10 === 0) { g.fillText(String(Math.abs(d)), hw + 8, y); g.fillText(String(Math.abs(d)), -hw - 26, y); }
    }
    g.restore();
    // Boresight pipper and flight path marker.
    g.strokeStyle = GREEN;
    g.beginPath(); g.arc(cx, cy, 6, 0, Math.PI * 2); g.stroke();
    if (s.velMarker && s.velMarker.visible) {
      const vm = s.velMarker;
      g.beginPath(); g.arc(vm.x, vm.y, 7, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.moveTo(vm.x - 14, vm.y); g.lineTo(vm.x - 7, vm.y); g.moveTo(vm.x + 7, vm.y); g.lineTo(vm.x + 14, vm.y); g.stroke();
    }

    // Heading compass ribbon at the top.
    const rw = 320, rx = cx - rw / 2, ry = 22;
    g.strokeStyle = GREEN; g.fillStyle = GREEN;
    g.beginPath(); g.moveTo(rx, ry + 16); g.lineTo(rx + rw, ry + 16); g.stroke();
    for (let deg = -60; deg <= 60; deg += 5) {
      const hd = Math.round((s.headingDeg + deg + 720) / 5) * 5;
      const x = cx + ((hd - s.headingDeg + 540) % 360 - 180) * (rw / 120);
      if (x < rx || x > rx + rw) continue;
      const major = hd % 10 === 0;
      g.beginPath(); g.moveTo(x, ry + 16); g.lineTo(x, ry + (major ? 6 : 11)); g.stroke();
      if (major) {
        const label = hd % 90 === 0 ? ({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' })[((hd % 360) + 360) % 360] || '' : String(hd % 360).padStart(3, '0');
        g.fillText(label, x, ry - 4);
      }
    }
    g.strokeStyle = AMBER; g.beginPath(); g.moveTo(cx, ry + 26); g.lineTo(cx - 6, ry + 36); g.lineTo(cx + 6, ry + 36); g.closePath(); g.stroke();
    g.fillStyle = GREEN;

    // Airspeed tape (left) and altitude tape (right).
    this.tape(16, cy - 130, 110, 260, s.airspeedKts, 50, 'KTS', 'left');
    this.tape(w - 126, cy - 130, 110, 260, s.altFt, 500, 'FT', 'right');
    g.fillStyle = GREEN;
    g.fillText('MACH ' + s.mach.toFixed(2), 16, cy + 146);
    g.fillText('G ' + s.gLoad.toFixed(1), 16, cy + 164);
    if (s.radarAlt !== undefined) g.fillText('RALT ' + Math.round(s.radarAlt * 3.281) + 'ft', 16, cy + 182);

    // Throttle, afterburner and fuel (bottom-left).
    const bx = 16, by = h - 150;
    g.fillStyle = GREEN;
    g.fillText(`THR ${Math.round(s.throttle * 100)}%${s.afterburner ? '  AB' : ''}`, bx, by);
    this.bar(bx, by + 18, 150, 8, s.throttle, GREEN);
    g.fillText(`FUEL ${Math.round(s.fuelPct)}%`, bx, by + 40);
    this.bar(bx, by + 58, 150, 8, s.fuelPct / 100, s.fuelPct < 15 ? RED : GREEN);
    g.fillText(`GEAR ${s.gearDown ? 'DOWN' : 'UP'}   FLAP ${Math.round(s.flaps * 100)}`, bx, by + 80);
    g.fillText(`SPD BRK ${s.brake > 0.5 ? 'OUT' : 'IN'}`, bx, by + 100);

    // Weapons (bottom-centre-left).
    const wx = cx - 140, wy = h - 70;
    g.fillStyle = AMBER;
    g.fillText(`WPN  ${s.weaponName}`, wx, wy);
    g.fillText(`GUN ${s.ammo}`, wx, wy + 20);
    g.fillText(`MSL ${s.missiles}   RKT ${s.rockets}   BMB ${s.bombs}`, wx, wy + 40);
    g.fillText(`FLR ${s.flares}   CHF ${s.chaff}`, wx, wy + 60);

    // Target info and lock brackets.
    if (s.target) {
      const t = s.target;
      const locked = s.lockState === 'locked';
      const blink = Math.floor(performance.now() / 150) % 2 === 0;
      const lockCol = locked ? (blink ? RED : '#ff8a8a') : CYAN;
      if (t.screen && t.screen.visible) {
        const sz = Math.max(18, Math.min(120, 2400 / Math.max(t.dist, 50)));
        g.strokeStyle = s.lockState === 'none' ? CYAN : lockCol; g.lineWidth = 2;
        const x = t.screen.x, y = t.screen.y;
        const L = sz * 0.3;
        for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          g.beginPath(); g.moveTo(x + sx * sz / 2, y + sy * sz / 2 - sy * L); g.lineTo(x + sx * sz / 2, y + sy * sz / 2); g.lineTo(x + sx * sz / 2 - sx * L, y + sy * sz / 2); g.stroke();
        }
        g.lineWidth = 1.5;
        if (s.lockState !== 'none' && s.lockProgress > 0) {
          g.strokeStyle = lockCol;
          g.beginPath(); g.arc(x, y, sz / 2 + 8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, s.lockProgress)); g.stroke();
        }
      }
      // Lead indicator for guns.
      if (s.lead && s.lead.visible) {
        g.strokeStyle = AMBER; g.lineWidth = 1.5;
        g.beginPath(); g.arc(s.lead.x, s.lead.y, 9, 0, Math.PI * 2); g.stroke();
      }
      // Target block (bottom-right).
      const tx = w - 220, ty = h - 150;
      g.fillStyle = locked ? RED : CYAN;
      g.fillText(`TGT ${t.name}`, tx, ty);
      g.fillText(`RNG ${(t.dist / 1000).toFixed(1)} km  ${t.kind === 'air' ? 'AIR' : 'GND'}`, tx, ty + 20);
      g.fillText(`LOCK ${s.lockState.toUpperCase()}${s.lockState === 'tracking' ? ' ' + Math.round(s.lockProgress * 100) + '%' : ''}`, tx, ty + 40);
      if (t.hpFrac !== undefined) { g.fillText('HP', tx, ty + 60); this.bar(tx + 30, ty + 60, 140, 8, t.hpFrac, t.hpFrac < 0.3 ? RED : GREEN); }
    }

    // Damage silhouette (bottom-right).
    this.damageSilhouette(w - 90, h - 300, s.damage);

    // G-force meter and objective text.
    this.drawObjective(s);

    // Radar (top-right corner).
    this.radar(w - 110, 130, 90, s);

    // Navigation marker (objective ring or target).
    if (s.nav && s.nav.visible) {
      g.strokeStyle = CYAN; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(s.nav.x, s.nav.y - 9); g.lineTo(s.nav.x + 9, s.nav.y); g.lineTo(s.nav.x, s.nav.y + 9); g.lineTo(s.nav.x - 9, s.nav.y); g.closePath(); g.stroke();
    }

    // Warnings: missile incoming (flashing with direction arrow), stall, pull up, low fuel.
    this.drawWarnings(s, dt);

    // Center messages.
    if (s.centerText && s.centerTextT > 0) {
      g.fillStyle = s.centerColor || GREEN;
      g.font = 'bold 26px "Courier New", monospace';
      g.textAlign = 'center';
      g.fillText(s.centerText, cx, cy - 170);
      g.font = '14px "Courier New", monospace';
      g.textAlign = 'left';
    }

    // Kill feed / popups.
    this.drawPopups(dt);

    // Overlays: night vision tag, paused hint, fps.
    if (s.nightVision) { g.fillStyle = GREEN; g.fillText('NVG', w - 58, 14); }
    if (s.showFps) { g.fillStyle = AMBER; g.fillText(`${Math.round(s.fps)} FPS`, w - 90, h - 14); }
    if (s.gBlackout) {
      g.fillStyle = 'rgba(0,0,0,0.0)';
    }
  }

  bar(x, y, w, h, frac, col) {
    const g = this.g;
    g.strokeStyle = col; g.lineWidth = 1;
    g.strokeRect(x, y, w, h);
    g.fillStyle = col;
    g.fillRect(x + 1, y + 1, Math.max(0, Math.min(1, frac)) * (w - 2), h - 2);
  }

  tape(x, y, w, h, value, step, label, side) {
    const g = this.g;
    g.strokeStyle = GREEN; g.fillStyle = GREEN; g.lineWidth = 1;
    g.strokeRect(x, y, w, h);
    const pxPer = h / 10;
    g.save();
    g.beginPath(); g.rect(x, y, w, h); g.clip();
    const base = Math.floor(value / step) * step;
    for (let i = -6; i <= 6; i++) {
      const v = base + i * step;
      const yy = y + h / 2 - (v - value) / step * pxPer;
      if (yy < y - 10 || yy > y + h + 10) continue;
      g.beginPath();
      if (side === 'left') g.moveTo(x + w, yy), g.lineTo(x + w - 10, yy); else g.moveTo(x, yy), g.lineTo(x + 10, yy);
      g.stroke();
      g.textAlign = side === 'left' ? 'right' : 'left';
      g.fillText(String(Math.round(v)), side === 'left' ? x + w - 14 : x + 14, yy);
    }
    g.restore();
    g.fillStyle = AMBER;
    g.textAlign = 'center';
    g.fillText(String(Math.round(value)), x + w / 2, y + h / 2);
    g.fillStyle = GREEN;
    g.fillText(label, x + w / 2, y - 12);
    g.textAlign = 'left';
  }

  damageSilhouette(x, y, d) {
    const g = this.g;
    const col = (v) => (v > 0.6 ? RED : v > 0.25 ? AMBER : GREEN);
    g.lineWidth = 2;
    g.strokeStyle = GREEN;
    // Fuselage
    g.strokeStyle = col(d.fuselage);
    g.beginPath(); g.moveTo(x + 40, y); g.lineTo(x + 46, y + 60); g.lineTo(x + 46, y + 120); g.lineTo(x + 34, y + 130); g.lineTo(x + 34, y + 60); g.closePath(); g.stroke();
    // Wings
    g.strokeStyle = col(d.wingL);
    g.beginPath(); g.moveTo(x + 34, y + 60); g.lineTo(x + 2, y + 92); g.lineTo(x + 6, y + 100); g.lineTo(x + 34, y + 90); g.stroke();
    g.strokeStyle = col(d.wingR);
    g.beginPath(); g.moveTo(x + 46, y + 60); g.lineTo(x + 78, y + 92); g.lineTo(x + 74, y + 100); g.lineTo(x + 46, y + 90); g.stroke();
    // Engine
    g.strokeStyle = col(d.engine);
    g.strokeRect(x + 36, y + 118, 8, 14);
    g.fillStyle = GREEN; g.font = '11px monospace';
    g.fillText('DAMAGE', x - 4, y - 12);
    g.font = '14px "Courier New", monospace';
  }

  radar(cx, cy, r, s) {
    const g = this.g;
    g.fillStyle = 'rgba(0,30,10,0.45)';
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
    g.strokeStyle = GREEN; g.lineWidth = 1.5;
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(cx, cy, r / 2, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(cx, cy - r); g.lineTo(cx, cy + r); g.moveTo(cx - r, cy); g.lineTo(cx + r, cy); g.stroke();
    g.save();
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.clip();
    for (const c of s.contacts || []) {
      const k = Math.min(1, Math.hypot(c.x, c.z) / s.radarRange);
      const ang = Math.atan2(c.x, -c.z);
      const px = cx + Math.sin(ang) * k * r, py = cy - Math.cos(ang) * k * r;
      g.fillStyle = c.team === 'enemy' ? RED : c.team === 'ally' ? '#4c9bff' : AMBER;
      if (c.kind === 'ground' || c.kind === 'ship') { g.fillRect(px - 3, py - 3, 6, 6); } else { g.beginPath(); g.arc(px, py, 3.5, 0, Math.PI * 2); g.fill(); }
    }
    g.restore();
    // Player at centre pointing up (map is heading-up).
    g.fillStyle = GREEN;
    g.beginPath(); g.moveTo(cx, cy - 6); g.lineTo(cx - 4, cy + 4); g.lineTo(cx + 4, cy + 4); g.closePath(); g.fill();
    g.font = '11px monospace'; g.fillStyle = GREEN;
    g.fillText(`RDR ${Math.round(s.radarRange / 1000)}km`, cx - r, cy + r + 12);
    g.font = '14px "Courier New", monospace';
  }

  drawObjective(s) {
    const g = this.g;
    if (!s.objective) return;
    g.fillStyle = 'rgba(0,0,0,0.35)';
    const tw = Math.min(620, this.w - 260);
    g.fillRect(this.w / 2 - tw / 2, 12, tw, 46);
    g.fillStyle = AMBER;
    g.textAlign = 'center';
    g.font = 'bold 15px "Courier New", monospace';
    g.fillText(s.objective, this.w / 2, 26);
    if (s.objectiveSub) { g.font = '13px "Courier New", monospace'; g.fillStyle = GREEN; g.fillText(s.objectiveSub, this.w / 2, 44); }
    g.textAlign = 'left';
    g.font = '14px "Courier New", monospace';
  }

  drawWarnings(s, dt) {
    const g = this.g, w = this.w, h = this.h;
    const blink = Math.floor(performance.now() / 180) % 2 === 0;
    const cx = w / 2;
    if (s.missileWarn && blink) {
      g.fillStyle = RED;
      g.font = 'bold 22px "Courier New", monospace';
      g.textAlign = 'center';
      g.fillText('MISSILE INCOMING', cx, h * 0.7);
      // Directional arrow: relative bearing of the threat around the aircraft.
      const b = s.missileWarn.bearing;
      const ax = cx + Math.sin(b) * 110, ay = h * 0.7 - 36 - Math.cos(b) * 0 + 0;
      g.save();
      g.translate(cx + Math.sin(b) * 140, h * 0.7 - 20);
      g.rotate(b);
      g.beginPath(); g.moveTo(0, -14); g.lineTo(-10, 8); g.lineTo(10, 8); g.closePath(); g.fill();
      g.restore();
      void ax; void ay;
      g.textAlign = 'left';
      g.font = '14px "Courier New", monospace';
    }
    g.textAlign = 'center';
    g.font = 'bold 20px "Courier New", monospace';
    if (s.stallWarn && blink) { g.fillStyle = AMBER; g.fillText('STALL WARNING', cx, h * 0.35); }
    if (s.pullUp) { g.fillStyle = RED; if (blink) g.fillText('PULL UP', cx, h * 0.38); }
    if (s.lowFuel && blink) { g.fillStyle = AMBER; g.fillText('LOW FUEL', cx, h * 0.42); }
    if (s.gRedout) { g.fillStyle = 'rgba(255,40,40,0.15)'; g.fillRect(0, 0, w, h); }
    g.textAlign = 'left';
    g.font = '14px "Courier New", monospace';
  }

  drawPopups(dt) {
    const g = this.g;
    this.popups = this.popups.filter((p) => (p.life -= dt) > 0);
    g.textAlign = 'center';
    g.font = 'bold 22px "Courier New", monospace';
    this.popups.forEach((p, i) => {
      const a = Math.min(1, p.life / 0.5);
      g.globalAlpha = a;
      g.fillStyle = p.color;
      g.fillText(p.text, this.w / 2, this.h * 0.25 + i * 28 - (p.max - p.life) * 10);
    });
    g.globalAlpha = 1;
    g.textAlign = 'left';
    g.font = '14px "Courier New", monospace';
  }

  // Droplets slide down the canopy in rain; frost creeps in at high altitude.
  drawGlass(s, dt) {
    const g = this.g, w = this.w, h = this.h;
    if (s.rain > 0.05) {
      g.fillStyle = 'rgba(200,220,240,0.12)';
      for (const d of this.drops) {
        d.y += d.v * dt * (0.5 + s.rain);
        if (d.y > 1.05) { d.y = -0.05; d.x = Math.random(); }
        g.beginPath();
        g.ellipse(d.x * w, d.y * h, d.r * 0.6, d.r, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
    if (s.frost > 0.02) {
      const grd = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.45, w / 2, h / 2, Math.max(w, h) * 0.75);
      grd.addColorStop(0, 'rgba(220,240,255,0)');
      grd.addColorStop(1, `rgba(220,240,255,${Math.min(0.7, s.frost)})`);
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
    }
  }
}
