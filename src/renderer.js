/**
 * Renderer — Canvas-based visual engine
 *
 * Draws:
 * - Piano keyboard at the bottom
 * - Falling notes (piano-roll style)
 * - Hit line
 * - Judgment feedback (Perfect!, Great!, etc.)
 * - HUD (score, combo, multiplier, progress)
 * - Hit effects (particles, glow)
 */

import { NoteState } from './game-engine.js';
import { isBlackKey } from './midi-engine.js';

// ─── Color Palette ───────────────────────────────────────────────

const COLORS = {
  background: '#0a0a0f',
  hitLine: '#ffffff',
  hitLineGlow: 'rgba(255, 255, 255, 0.3)',

  // Note colors by hand
  noteRight: '#00d4ff',      // Cyan for right hand
  noteRightGlow: '#00d4ff55',
  noteLeft: '#ff6b35',       // Orange for left hand
  noteLeftGlow: '#ff6b3555',

  // Judgment colors
  perfect: '#ffdd00',
  great: '#00ff88',
  good: '#88aaff',
  miss: '#ff3355',

  // Keyboard
  whiteKey: '#e8e8e8',
  whiteKeyPressed: '#00d4ff',
  blackKey: '#1a1a2e',
  blackKeyPressed: '#ff6b35',
  keyBorder: '#333344',

  // HUD
  hudText: '#ffffff',
  hudSecondary: '#888899',
  comboText: '#ffdd00',
  multiplierBg: '#ff6b35',

  // Progress bar
  progressBg: '#1a1a2e',
  progressFill: '#00d4ff',
};

// ─── Layout Constants ────────────────────────────────────────────

const PIANO_KEYS_START = 21;  // A0 (MIDI 21)
const PIANO_KEYS_END = 108;   // C8 (MIDI 108)
const TOTAL_KEYS = PIANO_KEYS_END - PIANO_KEYS_START + 1;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    // Layout dimensions (recalculated on resize)
    this.width = 0;
    this.height = 0;
    this.keyboardHeight = 0;
    this.hitLineY = 0;
    this.playAreaTop = 0;
    this.playAreaHeight = 0;

    // Key geometry cache
    this.keyPositions = [];

    // Visual effects
    this.particles = [];
    this.judgmentDisplay = null; // { text, color, time }
    this.activeKeys = new Set(); // Currently pressed keys for visual feedback

    // Handle resize
    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();

    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.scale(dpr, dpr);

    // Layout: HUD at top, play area in middle, keyboard at bottom
    this.keyboardHeight = Math.max(80, this.height * 0.12);
    this.hitLineY = this.height - this.keyboardHeight - 4;
    this.playAreaTop = 60; // Below HUD
    this.playAreaHeight = this.hitLineY - this.playAreaTop;

    this._calculateKeyPositions();
  }

  /**
   * Calculate X positions for each piano key
   */
  _calculateKeyPositions() {
    this.keyPositions = [];

    // Count white keys
    let whiteKeyCount = 0;
    for (let i = PIANO_KEYS_START; i <= PIANO_KEYS_END; i++) {
      if (!isBlackKey(i)) whiteKeyCount++;
    }

    const whiteKeyWidth = this.width / whiteKeyCount;
    const blackKeyWidth = whiteKeyWidth * 0.6;

    let whiteX = 0;

    for (let midi = PIANO_KEYS_START; midi <= PIANO_KEYS_END; midi++) {
      if (isBlackKey(midi)) {
        // Black key sits between white keys
        this.keyPositions[midi - PIANO_KEYS_START] = {
          x: whiteX - blackKeyWidth / 2,
          width: blackKeyWidth,
          isBlack: true,
          centerX: whiteX,
        };
      } else {
        this.keyPositions[midi - PIANO_KEYS_START] = {
          x: whiteX,
          width: whiteKeyWidth,
          isBlack: false,
          centerX: whiteX + whiteKeyWidth / 2,
        };
        whiteX += whiteKeyWidth;
      }
    }
  }

  /**
   * Get the X position and width for a given MIDI note
   */
  getNotePosition(pitch) {
    const idx = pitch - PIANO_KEYS_START;
    if (idx < 0 || idx >= this.keyPositions.length) return null;
    return this.keyPositions[idx];
  }

  // ─── Main Render Loop ──────────────────────────────────────────

  /**
   * Render a single frame
   */
  render(gameEngine) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    // Background
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, this.width, this.height);

    if (!gameEngine.chart) return;

    // Draw layers bottom-to-top
    this._drawKeyboard(ctx, gameEngine);
    this._drawHitLine(ctx);
    this._drawNotes(ctx, gameEngine);
    this._drawParticles(ctx);
    this._drawJudgment(ctx);
    this._drawHUD(ctx, gameEngine);
    this._drawProgress(ctx, gameEngine);
  }

  // ─── Drawing Functions ─────────────────────────────────────────

  _drawKeyboard(ctx, gameEngine) {
    const y = this.height - this.keyboardHeight;
    const whiteHeight = this.keyboardHeight;
    const blackHeight = this.keyboardHeight * 0.6;

    // Draw white keys first
    for (let midi = PIANO_KEYS_START; midi <= PIANO_KEYS_END; midi++) {
      const pos = this.getNotePosition(midi);
      if (!pos || pos.isBlack) continue;

      const isPressed = this.activeKeys.has(midi);

      ctx.fillStyle = isPressed ? COLORS.whiteKeyPressed : COLORS.whiteKey;
      ctx.fillRect(pos.x, y, pos.width - 1, whiteHeight);

      if (isPressed) {
        ctx.fillStyle = COLORS.noteRightGlow;
        ctx.fillRect(pos.x, y, pos.width - 1, whiteHeight);
      }
    }

    // Draw black keys on top
    for (let midi = PIANO_KEYS_START; midi <= PIANO_KEYS_END; midi++) {
      const pos = this.getNotePosition(midi);
      if (!pos || !pos.isBlack) continue;

      const isPressed = this.activeKeys.has(midi);

      ctx.fillStyle = isPressed ? COLORS.blackKeyPressed : COLORS.blackKey;
      ctx.fillRect(pos.x, y, pos.width, blackHeight);
    }
  }

  _drawHitLine(ctx) {
    // Glow effect
    ctx.strokeStyle = COLORS.hitLineGlow;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(0, this.hitLineY);
    ctx.lineTo(this.width, this.hitLineY);
    ctx.stroke();

    // Main line
    ctx.strokeStyle = COLORS.hitLine;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, this.hitLineY);
    ctx.lineTo(this.width, this.hitLineY);
    ctx.stroke();
  }

  _drawNotes(ctx, gameEngine) {
    const { chart, currentTime, noteStates, scrollSpeed } = gameEngine;
    const pixelsPerSecond = this.playAreaHeight / scrollSpeed;

    for (let i = 0; i < chart.notes.length; i++) {
      const note = chart.notes[i];
      const state = noteStates[i];

      // Skip notes that are too far away or already fully resolved
      const timeDelta = note.time - currentTime;
      if (timeDelta > scrollSpeed + 1) continue;
      if (timeDelta < -1 && state !== NoteState.ACTIVE && state !== NoteState.UPCOMING) continue;

      const pos = this.getNotePosition(note.pitch);
      if (!pos) continue;

      // Y position: hit line is where time = note.time
      const noteY = this.hitLineY - timeDelta * pixelsPerSecond;
      const noteHeight = Math.max(4, note.duration * pixelsPerSecond);

      // Note width
      const noteWidth = pos.isBlack ? pos.width * 1.2 : pos.width - 2;
      const noteX = pos.centerX - noteWidth / 2;

      // Color based on state and hand
      let color, glowColor;
      if (note.hand === 'left') {
        color = COLORS.noteLeft;
        glowColor = COLORS.noteLeftGlow;
      } else {
        color = COLORS.noteRight;
        glowColor = COLORS.noteRightGlow;
      }

      switch (state) {
        case NoteState.HIT_PERFECT:
        case NoteState.HIT_GREAT:
        case NoteState.HIT_GOOD:
          // Fade out hit notes
          ctx.globalAlpha = Math.max(0, 1 - (currentTime - note.time) * 3);
          ctx.fillStyle = state === NoteState.HIT_PERFECT ? COLORS.perfect : color;
          ctx.fillRect(noteX, noteY - noteHeight, noteWidth, noteHeight);
          ctx.globalAlpha = 1;
          continue;

        case NoteState.MISSED:
          ctx.globalAlpha = 0.2;
          ctx.fillStyle = COLORS.miss;
          ctx.fillRect(noteX, noteY - noteHeight, noteWidth, noteHeight);
          ctx.globalAlpha = 1;
          continue;
      }

      // Active/upcoming notes
      // Glow behind the note
      ctx.fillStyle = glowColor;
      ctx.fillRect(noteX - 2, noteY - noteHeight - 2, noteWidth + 4, noteHeight + 4);

      // Note body (rounded rect)
      ctx.fillStyle = color;
      this._roundRect(ctx, noteX, noteY - noteHeight, noteWidth, noteHeight, 3);

      // Note label (for wider notes)
      if (noteWidth > 20 && noteHeight > 12) {
        ctx.fillStyle = '#000000';
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(note.name, noteX + noteWidth / 2, noteY - noteHeight / 2 + 4);
      }
    }
  }

  _drawParticles(ctx) {
    const now = performance.now();
    this.particles = this.particles.filter((p) => now - p.born < p.lifetime);

    for (const p of this.particles) {
      const age = (now - p.born) / p.lifetime;
      ctx.globalAlpha = 1 - age;
      ctx.fillStyle = p.color;
      const size = p.size * (1 - age * 0.5);
      ctx.fillRect(
        p.x + p.vx * age * 100 - size / 2,
        p.y + p.vy * age * 100 - size / 2,
        size,
        size
      );
    }
    ctx.globalAlpha = 1;
  }

  _drawJudgment(ctx) {
    if (!this.judgmentDisplay) return;

    const age = performance.now() - this.judgmentDisplay.time;
    if (age > 600) {
      this.judgmentDisplay = null;
      return;
    }

    const alpha = Math.max(0, 1 - age / 600);
    const scale = 1 + Math.sin(age / 100) * 0.05;
    const yOffset = -age * 0.03;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = this.judgmentDisplay.color;
    ctx.font = `bold ${Math.round(28 * scale)}px "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(
      this.judgmentDisplay.text,
      this.width / 2,
      this.hitLineY - 60 + yOffset
    );

    // Delta display
    if (this.judgmentDisplay.delta !== undefined) {
      ctx.font = '14px monospace';
      ctx.fillStyle = COLORS.hudSecondary;
      ctx.fillText(
        `${this.judgmentDisplay.delta > 0 ? '+' : ''}${this.judgmentDisplay.delta}ms`,
        this.width / 2,
        this.hitLineY - 30 + yOffset
      );
    }

    ctx.restore();
  }

  _drawHUD(ctx, gameEngine) {
    const padding = 20;

    // Score (top left)
    ctx.fillStyle = COLORS.hudText;
    ctx.font = 'bold 24px "Segoe UI", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(gameEngine.score.toLocaleString(), padding, 35);

    // Multiplier badge
    if (gameEngine.multiplier > 1) {
      const mulText = `${gameEngine.multiplier}x`;
      ctx.font = 'bold 16px "Segoe UI", sans-serif';
      const mulWidth = ctx.measureText(mulText).width + 16;
      const mulX = padding + ctx.measureText(gameEngine.score.toLocaleString()).width + 15;

      ctx.fillStyle = COLORS.multiplierBg;
      this._roundRect(ctx, mulX, 18, mulWidth, 24, 12);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 14px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(mulText, mulX + mulWidth / 2, 35);
    }

    // Combo (top right)
    if (gameEngine.combo > 0) {
      ctx.textAlign = 'right';
      ctx.fillStyle = COLORS.comboText;
      ctx.font = `bold ${Math.min(36, 20 + gameEngine.combo * 0.3)}px "Segoe UI", sans-serif`;
      ctx.fillText(`${gameEngine.combo}`, this.width - padding, 35);

      ctx.fillStyle = COLORS.hudSecondary;
      ctx.font = '12px "Segoe UI", sans-serif';
      ctx.fillText('COMBO', this.width - padding, 50);
    }

    // Song title (top center)
    ctx.textAlign = 'center';
    ctx.fillStyle = COLORS.hudSecondary;
    ctx.font = '13px "Segoe UI", sans-serif';
    ctx.fillText(gameEngine.chart.title, this.width / 2, 20);

    // BPM
    ctx.font = '11px monospace';
    ctx.fillText(`${gameEngine.chart.bpm} BPM`, this.width / 2, 38);
  }

  _drawProgress(ctx, gameEngine) {
    const barHeight = 3;
    const y = 55;
    const progress = gameEngine.currentTime / gameEngine.chart.totalDuration;

    ctx.fillStyle = COLORS.progressBg;
    ctx.fillRect(0, y, this.width, barHeight);

    ctx.fillStyle = COLORS.progressFill;
    ctx.fillRect(0, y, this.width * Math.min(1, progress), barHeight);
  }

  // ─── Visual Effects ────────────────────────────────────────────

  /**
   * Show a hit judgment animation
   */
  showJudgment(judgment, deltaMs) {
    const labels = {
      perfect: 'PERFECT',
      great: 'GREAT',
      good: 'GOOD',
    };
    const colors = {
      perfect: COLORS.perfect,
      great: COLORS.great,
      good: COLORS.good,
    };

    this.judgmentDisplay = {
      text: labels[judgment] || judgment.toUpperCase(),
      color: colors[judgment] || COLORS.hudText,
      delta: deltaMs,
      time: performance.now(),
    };
  }

  /**
   * Spawn hit particles at a note position
   */
  spawnHitParticles(pitch, judgment) {
    const pos = this.getNotePosition(pitch);
    if (!pos) return;

    const color = judgment === 'perfect' ? COLORS.perfect :
                  judgment === 'great' ? COLORS.great : COLORS.good;
    const count = judgment === 'perfect' ? 12 : 6;

    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: pos.centerX,
        y: this.hitLineY,
        vx: (Math.random() - 0.5) * 3,
        vy: -(Math.random() * 2 + 1),
        size: Math.random() * 6 + 2,
        color,
        born: performance.now(),
        lifetime: 400 + Math.random() * 200,
      });
    }
  }

  /**
   * Mark a key as active (pressed) for visual feedback
   */
  pressKey(pitch) {
    this.activeKeys.add(pitch);
  }

  releaseKey(pitch) {
    this.activeKeys.delete(pitch);
  }

  // ─── Render Special Screens ────────────────────────────────────

  renderCountdown(count) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, this.width, this.height);

    ctx.fillStyle = COLORS.perfect;
    ctx.font = 'bold 80px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(count.toString(), this.width / 2, this.height / 2);
    ctx.textBaseline = 'alphabetic';
  }

  renderResults(results) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, this.width, this.height);

    const cx = this.width / 2;
    let y = 80;

    // Grade
    const gradeColors = { S: '#ffdd00', A: '#00ff88', B: '#00d4ff', C: '#88aaff', D: '#ff6b35', F: '#ff3355' };
    ctx.fillStyle = gradeColors[results.grade] || COLORS.hudText;
    ctx.font = 'bold 72px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(results.grade, cx, y += 60);

    // Score
    ctx.fillStyle = COLORS.hudText;
    ctx.font = 'bold 36px "Segoe UI", sans-serif';
    ctx.fillText(results.score.toLocaleString(), cx, y += 60);

    // Accuracy
    ctx.fillStyle = COLORS.hudSecondary;
    ctx.font = '20px "Segoe UI", sans-serif';
    ctx.fillText(`${results.accuracy}% Accuracy`, cx, y += 40);

    // Max Combo
    ctx.fillStyle = COLORS.comboText;
    ctx.font = '18px "Segoe UI", sans-serif';
    ctx.fillText(`Max Combo: ${results.maxCombo}`, cx, y += 35);

    // Hit breakdown
    y += 30;
    const breakdown = [
      { label: 'Perfect', count: results.perfect, color: COLORS.perfect },
      { label: 'Great', count: results.great, color: COLORS.great },
      { label: 'Good', count: results.good, color: COLORS.good },
      { label: 'Miss', count: results.miss, color: COLORS.miss },
    ];

    for (const item of breakdown) {
      ctx.fillStyle = item.color;
      ctx.font = '16px "Segoe UI", sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(item.label, cx - 10, y);
      ctx.textAlign = 'left';
      ctx.fillText(item.count.toString(), cx + 10, y);
      y += 28;
    }

    // Restart hint
    ctx.fillStyle = COLORS.hudSecondary;
    ctx.font = '14px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Press SPACE or click to restart', cx, this.height - 40);
  }

  // ─── Helpers ───────────────────────────────────────────────────

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
    ctx.fill();
  }
}
