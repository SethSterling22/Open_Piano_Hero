/**
 * MIDI Diagnostics — Visual testing tool for verifying piano connection
 *
 * Features:
 * - Visual 88-key keyboard with real-time press feedback
 * - Velocity meter per key press
 * - Pedal state indicators
 * - Scrolling event log with raw MIDI data
 * - Statistics: total notes, notes per second, range tested
 * - Key coverage tracker (shows which keys have been tested)
 */

import { isBlackKey, noteName } from './midi-engine.js';

const PIANO_START = 21; // A0
const PIANO_END = 108;  // C8
const TOTAL_KEYS = PIANO_END - PIANO_START + 1;

export class MidiDiagnostics {
  constructor(container) {
    this.container = container;
    this.canvas = null;
    this.ctx = null;
    this.logEl = null;

    // State
    this.activeNotes = new Map();  // pitch -> { velocity, timestamp }
    this.keyHitCount = new Array(128).fill(0);
    this.pedalState = { sustain: false, sostenuto: false, soft: false };
    this.eventLog = [];
    this.maxLogEntries = 150;

    // Stats
    this.totalNoteOns = 0;
    this.totalNoteOffs = 0;
    this.sessionStart = 0;
    this.lastNoteTime = 0;
    this.minPitch = 128;
    this.maxPitch = -1;
    this.maxVelocity = 0;
    this.minVelocity = 128;
    this.velocityHistory = [];

    // Layout cache
    this.keyPositions = [];
    this.width = 0;
    this.height = 0;

    // Animation
    this._animId = null;
    this._fadeNotes = new Map(); // pitch -> fadeStartTime
  }

  /**
   * Build the diagnostics UI and start rendering
   */
  init() {
    this.sessionStart = performance.now();
    this.container.innerHTML = '';

    this.container.innerHTML = `
      <div class="diag-layout">
        <div class="diag-top">
          <div class="diag-stats" id="diag-stats"></div>
          <div class="diag-pedals" id="diag-pedals">
            <div class="pedal-box" id="pedal-sustain"><span class="pedal-dot"></span>Sustain</div>
            <div class="pedal-box" id="pedal-sostenuto"><span class="pedal-dot"></span>Sostenuto</div>
            <div class="pedal-box" id="pedal-soft"><span class="pedal-dot"></span>Soft</div>
          </div>
        </div>
        <div class="diag-keyboard-wrap">
          <canvas id="diag-canvas"></canvas>
          <div class="diag-velocity-bar" id="diag-velocity">
            <div class="vel-fill" id="vel-fill"></div>
            <span class="vel-label" id="vel-label">--</span>
          </div>
        </div>
        <div class="diag-coverage" id="diag-coverage">
          <div class="coverage-label">Key Coverage: <span id="coverage-pct">0%</span> (<span id="coverage-count">0</span>/${TOTAL_KEYS} keys)</div>
          <div class="coverage-bar" id="coverage-bar"></div>
        </div>
        <div class="diag-last-note" id="diag-last-note">
          <span class="last-note-label">Last Note:</span>
          <span class="last-note-value" id="last-note-value">-- Press any key --</span>
        </div>
        <div class="diag-log-wrap">
          <div class="diag-log-header">Event Log <span class="log-count" id="log-count">0</span></div>
          <div class="diag-log" id="diag-log"></div>
        </div>
      </div>
    `;

    this.canvas = this.container.querySelector('#diag-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.logEl = this.container.querySelector('#diag-log');
    this.statsEl = this.container.querySelector('#diag-stats');

    this._buildCoverageBar();
    this._resize();
    this._resizeHandler = () => this._resize();
    window.addEventListener('resize', this._resizeHandler);
    this._startRendering();
  }

  /**
   * Handle incoming Note On
   */
  noteOn(pitch, velocity, channel, timestamp) {
    this.activeNotes.set(pitch, { velocity, timestamp, channel });
    this.keyHitCount[pitch]++;
    this.totalNoteOns++;
    this.lastNoteTime = performance.now();

    if (pitch < this.minPitch) this.minPitch = pitch;
    if (pitch > this.maxPitch) this.maxPitch = pitch;
    if (velocity > this.maxVelocity) this.maxVelocity = velocity;
    if (velocity < this.minVelocity) this.minVelocity = velocity;
    this.velocityHistory.push(velocity);
    if (this.velocityHistory.length > 100) this.velocityHistory.shift();

    this._fadeNotes.delete(pitch);
    this._updateVelocityBar(velocity);

    const lastNoteEl = this.container.querySelector('#last-note-value');
    if (lastNoteEl) {
      lastNoteEl.textContent = `${noteName(pitch)} (MIDI ${pitch}) vel: ${velocity} ch: ${channel + 1}`;
      lastNoteEl.style.color = velocity > 100 ? '#ff6b35' : velocity > 60 ? '#00d4ff' : '#00ff88';
    }

    this._addLog('note-on', `NOTE ON  ${noteName(pitch).padEnd(4)} MIDI:${String(pitch).padStart(3)} vel:${String(velocity).padStart(3)} ch:${channel + 1}`);
    this._updateCoverage(pitch);
  }

  /**
   * Handle incoming Note Off
   */
  noteOff(pitch, channel, timestamp) {
    this.activeNotes.delete(pitch);
    this.totalNoteOffs++;
    this._fadeNotes.set(pitch, performance.now());
    this._addLog('note-off', `NOTE OFF ${noteName(pitch).padEnd(4)} MIDI:${String(pitch).padStart(3)}           ch:${channel + 1}`);
  }

  /**
   * Handle pedal change
   */
  pedalChange(type, value, channel, timestamp) {
    this.pedalState[type] = value >= 64;
    const pedalEl = this.container.querySelector(`#pedal-${type}`);
    if (pedalEl) pedalEl.classList.toggle('active', value >= 64);
    this._addLog('pedal', `PEDAL    ${type.toUpperCase().padEnd(10)} val:${String(value).padStart(3)} ${value >= 64 ? 'ON ' : 'OFF'} ch:${channel + 1}`);
  }

  /**
   * Handle raw MIDI message (for hex display)
   */
  rawMessage(data, timestamp) {
    const msgType = data[0] & 0xf0;
    if (msgType !== 0x90 && msgType !== 0x80 && msgType !== 0xb0) {
      const hex = Array.from(data).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
      this._addLog('raw', `RAW      ${hex}`);
    }
  }

  /**
   * Clean up
   */
  destroy() {
    if (this._animId) cancelAnimationFrame(this._animId);
    window.removeEventListener('resize', this._resizeHandler);
    this.container.innerHTML = '';
  }

  // ─── Private methods ───────────────────────────────────────────

  _resize() {
    const wrap = this.canvas.parentElement;
    const dpr = window.devicePixelRatio || 1;
    const rect = wrap.getBoundingClientRect();

    this.width = rect.width;
    this.height = Math.max(120, rect.height);
    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.canvas.style.width = this.width + 'px';
    this.canvas.style.height = this.height + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._calcKeys();
  }

  _calcKeys() {
    this.keyPositions = [];
    let whiteCount = 0;
    for (let i = PIANO_START; i <= PIANO_END; i++) if (!isBlackKey(i)) whiteCount++;
    const ww = this.width / whiteCount;
    const bw = ww * 0.65;
    let wx = 0;

    for (let midi = PIANO_START; midi <= PIANO_END; midi++) {
      if (isBlackKey(midi)) {
        this.keyPositions[midi - PIANO_START] = { x: wx - bw / 2, w: bw, black: true, cx: wx };
      } else {
        this.keyPositions[midi - PIANO_START] = { x: wx, w: ww, black: false, cx: wx + ww / 2 };
        wx += ww;
      }
    }
  }

  _startRendering() {
    const draw = () => {
      this._drawKeyboard();
      this._updateStats();
      this._animId = requestAnimationFrame(draw);
    };
    this._animId = requestAnimationFrame(draw);
  }

  _drawKeyboard() {
    const ctx = this.ctx;
    const h = this.height;
    const blackH = h * 0.6;
    const now = performance.now();

    ctx.clearRect(0, 0, this.width, h);
    ctx.fillStyle = '#0d0d15';
    ctx.fillRect(0, 0, this.width, h);

    // White keys
    for (let midi = PIANO_START; midi <= PIANO_END; midi++) {
      const kp = this.keyPositions[midi - PIANO_START];
      if (!kp || kp.black) continue;

      const isActive = this.activeNotes.has(midi);
      const fadeStart = this._fadeNotes.get(midi);
      const isFading = fadeStart && (now - fadeStart) < 300;

      if (isActive) {
        const vel = this.activeNotes.get(midi).velocity;
        const intensity = vel / 127;
        ctx.fillStyle = `rgb(${Math.round(intensity * 0)}, ${Math.round(180 + intensity * 75)}, ${Math.round(220 + intensity * 35)})`;
      } else if (isFading) {
        const fade = (now - fadeStart) / 300;
        ctx.fillStyle = `rgba(0, 212, 255, ${0.4 * (1 - fade)})`;
        ctx.fillRect(kp.x + 1, 0, kp.w - 2, h);
        ctx.fillStyle = '#e0e0e0';
      } else if (this.keyHitCount[midi] > 0) {
        ctx.fillStyle = '#d8f0d8';
      } else {
        ctx.fillStyle = '#e0e0e0';
      }
      ctx.fillRect(kp.x + 1, 0, kp.w - 2, h);

      // Velocity bar on active keys
      if (isActive) {
        const vel = this.activeNotes.get(midi).velocity;
        const barH = (vel / 127) * h * 0.3;
        ctx.fillStyle = vel > 100 ? '#ff6b35' : vel > 60 ? '#00d4ff' : '#00ff88';
        ctx.fillRect(kp.x + 2, h - barH, kp.w - 4, barH);
      }

      // Hit count
      if (this.keyHitCount[midi] > 0 && !isActive) {
        ctx.fillStyle = '#888';
        ctx.font = '8px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(this.keyHitCount[midi].toString(), kp.cx, h - 4);
      }
    }

    // Black keys
    for (let midi = PIANO_START; midi <= PIANO_END; midi++) {
      const kp = this.keyPositions[midi - PIANO_START];
      if (!kp || !kp.black) continue;

      const isActive = this.activeNotes.has(midi);
      const fadeStart = this._fadeNotes.get(midi);
      const isFading = fadeStart && (now - fadeStart) < 300;

      if (isActive) {
        const vel = this.activeNotes.get(midi).velocity;
        const intensity = vel / 127;
        ctx.fillStyle = `rgb(${Math.round(200 + intensity * 55)}, ${Math.round(80 + intensity * 27)}, ${Math.round(30 + intensity * 23)})`;
      } else if (isFading) {
        const fade = (now - fadeStart) / 300;
        ctx.fillStyle = `rgba(255, 107, 53, ${0.5 * (1 - fade)})`;
        ctx.fillRect(kp.x, 0, kp.w, blackH);
        ctx.fillStyle = '#1a1a2e';
      } else if (this.keyHitCount[midi] > 0) {
        ctx.fillStyle = '#2a2a4e';
      } else {
        ctx.fillStyle = '#1a1a2e';
      }
      ctx.fillRect(kp.x, 0, kp.w, blackH);

      if (isActive) {
        const vel = this.activeNotes.get(midi).velocity;
        const barH = (vel / 127) * blackH * 0.3;
        ctx.fillStyle = vel > 100 ? '#ff6b35' : '#ffaa00';
        ctx.fillRect(kp.x + 1, blackH - barH, kp.w - 2, barH);
      }
    }

    // Clean old fades
    for (const [pitch, start] of this._fadeNotes) {
      if (now - start > 300) this._fadeNotes.delete(pitch);
    }

    // C key labels
    ctx.fillStyle = '#666';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    for (let midi = PIANO_START; midi <= PIANO_END; midi++) {
      if (midi % 12 === 0) {
        const kp = this.keyPositions[midi - PIANO_START];
        if (kp) ctx.fillText(noteName(midi), kp.cx, h - 14);
      }
    }
  }

  _updateVelocityBar(velocity) {
    const fill = this.container.querySelector('#vel-fill');
    const label = this.container.querySelector('#vel-label');
    if (!fill || !label) return;

    const pct = (velocity / 127) * 100;
    fill.style.width = pct + '%';
    fill.style.background = velocity > 100 ? '#ff6b35' : velocity > 60 ? '#00d4ff' : '#00ff88';
    label.textContent = `${velocity} (${velocity > 100 ? 'ff' : velocity > 80 ? 'f' : velocity > 60 ? 'mf' : velocity > 40 ? 'mp' : velocity > 20 ? 'p' : 'pp'})`;
  }

  _updateStats() {
    if (!this.statsEl) return;
    const elapsed = (performance.now() - this.sessionStart) / 1000;
    const nps = elapsed > 1 ? (this.totalNoteOns / elapsed).toFixed(1) : '0.0';
    const avgVel = this.velocityHistory.length > 0
      ? Math.round(this.velocityHistory.reduce((a, b) => a + b, 0) / this.velocityHistory.length) : '--';
    const range = this.minPitch <= this.maxPitch
      ? `${noteName(this.minPitch)} - ${noteName(this.maxPitch)}` : '--';

    this.statsEl.innerHTML = `
      <div class="stat"><span class="stat-val">${this.totalNoteOns}</span><span class="stat-label">Notes</span></div>
      <div class="stat"><span class="stat-val">${nps}</span><span class="stat-label">Notes/s</span></div>
      <div class="stat"><span class="stat-val">${avgVel}</span><span class="stat-label">Avg Vel</span></div>
      <div class="stat"><span class="stat-val">${this.activeNotes.size}</span><span class="stat-label">Active</span></div>
      <div class="stat"><span class="stat-val">${range}</span><span class="stat-label">Range</span></div>
    `;
  }

  _buildCoverageBar() {
    const bar = this.container.querySelector('#coverage-bar');
    if (!bar) return;
    bar.innerHTML = '';
    for (let midi = PIANO_START; midi <= PIANO_END; midi++) {
      const el = document.createElement('div');
      el.className = `cov-key ${isBlackKey(midi) ? 'cov-black' : 'cov-white'}`;
      el.dataset.midi = midi;
      el.title = noteName(midi);
      bar.appendChild(el);
    }
  }

  _updateCoverage(pitch) {
    const bar = this.container.querySelector('#coverage-bar');
    if (bar) {
      const keyEl = bar.querySelector(`[data-midi="${pitch}"]`);
      if (keyEl) keyEl.classList.add('cov-hit');
    }
    let tested = 0;
    for (let i = PIANO_START; i <= PIANO_END; i++) {
      if (this.keyHitCount[i] > 0) tested++;
    }
    const pctEl = this.container.querySelector('#coverage-pct');
    const countEl = this.container.querySelector('#coverage-count');
    if (pctEl) pctEl.textContent = Math.round((tested / TOTAL_KEYS) * 100) + '%';
    if (countEl) countEl.textContent = tested;
  }

  _addLog(type, message) {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false, fractionalSecondDigits: 1 });
    this.eventLog.push({ type, message, time });
    if (this.eventLog.length > this.maxLogEntries) this.eventLog.shift();

    if (this.logEl) {
      const entry = document.createElement('div');
      entry.className = `log-entry log-${type}`;
      entry.textContent = `[${time}] ${message}`;
      this.logEl.appendChild(entry);
      this.logEl.scrollTop = this.logEl.scrollHeight;
      while (this.logEl.children.length > this.maxLogEntries) {
        this.logEl.removeChild(this.logEl.firstChild);
      }
    }

    const countEl = this.container.querySelector('#log-count');
    if (countEl) countEl.textContent = this.totalNoteOns + this.totalNoteOffs;
  }

  /**
   * Reset all stats and coverage
   */
  resetStats() {
    this.keyHitCount = new Array(128).fill(0);
    this.totalNoteOns = 0;
    this.totalNoteOffs = 0;
    this.sessionStart = performance.now();
    this.minPitch = 128;
    this.maxPitch = -1;
    this.maxVelocity = 0;
    this.minVelocity = 128;
    this.velocityHistory = [];
    this.eventLog = [];
    if (this.logEl) this.logEl.innerHTML = '';
    const bar = this.container.querySelector('#coverage-bar');
    if (bar) bar.querySelectorAll('.cov-hit').forEach(el => el.classList.remove('cov-hit'));
    const pctEl = this.container.querySelector('#coverage-pct');
    const countEl = this.container.querySelector('#coverage-count');
    if (pctEl) pctEl.textContent = '0%';
    if (countEl) countEl.textContent = '0';
  }
}
