/**
 * Game Engine — Core game logic, timing, and scoring
 *
 * Responsibilities:
 * - Game state management (menu, countdown, playing, paused, results)
 * - Timing judge: compare player input vs chart notes
 * - Scoring: accuracy, combo, multiplier
 * - Note lifecycle tracking
 */

// ─── Hit Window Configuration ────────────────────────────────────

const HIT_WINDOWS = {
  perfect: 0.030,  // ±30ms
  great: 0.060,    // ±60ms
  good: 0.100,     // ±100ms
  miss: 0.150,     // beyond this = miss
};

const SCORE_VALUES = {
  perfect: 100,
  great: 75,
  good: 50,
  miss: 0,
};

const COMBO_MULTIPLIER_THRESHOLDS = [10, 25, 50, 100];

// ─── Game States ─────────────────────────────────────────────────

export const GameState = {
  MENU: 'menu',
  COUNTDOWN: 'countdown',
  PLAYING: 'playing',
  PAUSED: 'paused',
  RESULTS: 'results',
};

// ─── Note States ─────────────────────────────────────────────────

export const NoteState = {
  UPCOMING: 'upcoming',   // Not yet in play
  ACTIVE: 'active',       // In the hit window
  HIT_PERFECT: 'hit_perfect',
  HIT_GREAT: 'hit_great',
  HIT_GOOD: 'hit_good',
  MISSED: 'missed',
};

// ─── Game Engine Class ───────────────────────────────────────────

export class GameEngine {
  constructor() {
    this.state = GameState.MENU;
    this.chart = null;
    this.noteStates = [];       // State of each chart note
    this.currentTime = 0;       // Current playback position in seconds
    this.startTimestamp = 0;    // performance.now() when game started
    this.pauseOffset = 0;       // Accumulated pause time

    // Scoring
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.multiplier = 1;
    this.hitCounts = { perfect: 0, great: 0, good: 0, miss: 0 };

    // Settings
    this.latencyOffset = 0;     // ms, compensate for USB/audio latency
    this.scrollSpeed = 3;       // Seconds of notes visible ahead

    // Events
    this.onHit = null;          // (noteIndex, judgment, deltaMs) => {}
    this.onMiss = null;         // (noteIndex) => {}
    this.onComboBreak = null;   // (combo) => {}
    this.onStateChange = null;  // (newState, oldState) => {}

    // Tracking active input for matching
    this._pendingInputs = [];
  }

  /**
   * Load a chart and prepare game state
   */
  loadChart(chart) {
    this.chart = chart;
    this.noteStates = chart.notes.map(() => NoteState.UPCOMING);
    this._resetScore();
  }

  /**
   * Start the game (after countdown)
   */
  start() {
    if (!this.chart) throw new Error('No chart loaded');
    this._setState(GameState.COUNTDOWN);

    // 3-second countdown before music starts
    this.countdownRemaining = 3;
    this._countdownInterval = setInterval(() => {
      this.countdownRemaining--;
      if (this.countdownRemaining <= 0) {
        clearInterval(this._countdownInterval);
        this._beginPlayback();
      }
    }, 1000);
  }

  _beginPlayback() {
    this.startTimestamp = performance.now();
    this.pauseOffset = 0;
    this._setState(GameState.PLAYING);
  }

  /**
   * Pause/resume
   */
  togglePause() {
    if (this.state === GameState.PLAYING) {
      this._pauseStart = performance.now();
      this._setState(GameState.PAUSED);
    } else if (this.state === GameState.PAUSED) {
      this.pauseOffset += performance.now() - this._pauseStart;
      this._setState(GameState.PLAYING);
    }
  }

  /**
   * Main update loop — call every frame
   */
  update(timestamp) {
    if (this.state !== GameState.PLAYING) return;

    // Calculate current song time
    this.currentTime =
      (timestamp - this.startTimestamp - this.pauseOffset) / 1000;

    // Check for missed notes
    this._checkMissedNotes();

    // Check if song is over
    if (this.chart && this.currentTime > this.chart.totalDuration + 2) {
      this._setState(GameState.RESULTS);
    }
  }

  /**
   * Handle a Note On from the player's MIDI input
   */
  handleNoteOn(pitch, velocity, timestamp) {
    if (this.state !== GameState.PLAYING) return;

    // Adjust for latency offset
    const adjustedTime =
      this.currentTime - this.latencyOffset / 1000;

    // Find the best matching chart note
    const match = this._findBestMatch(pitch, adjustedTime);

    if (match !== null) {
      const note = this.chart.notes[match.index];
      const delta = match.delta;
      const absDelta = Math.abs(delta);
      let judgment;

      if (absDelta <= HIT_WINDOWS.perfect) {
        judgment = 'perfect';
        this.noteStates[match.index] = NoteState.HIT_PERFECT;
      } else if (absDelta <= HIT_WINDOWS.great) {
        judgment = 'great';
        this.noteStates[match.index] = NoteState.HIT_GREAT;
      } else if (absDelta <= HIT_WINDOWS.good) {
        judgment = 'good';
        this.noteStates[match.index] = NoteState.HIT_GOOD;
      } else {
        // Too early or too late but within scanning range
        return; // Don't count it
      }

      // Update score
      this.hitCounts[judgment]++;
      this.combo++;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      this._updateMultiplier();
      this.score += SCORE_VALUES[judgment] * this.multiplier;

      // Velocity bonus on expert
      if (this.chart.matchVelocity) {
        const velDelta = Math.abs(velocity / 127 - note.velocity);
        if (velDelta < 0.15) {
          this.score += 20 * this.multiplier;
        }
      }

      this.onHit?.(match.index, judgment, Math.round(delta * 1000));
    }
  }

  /**
   * Handle Note Off (currently used for tracking only)
   */
  handleNoteOff(pitch, timestamp) {
    // Could be extended for held note scoring
  }

  // ─── Internal Logic ────────────────────────────────────────────

  /**
   * Find the closest unplayed chart note matching the given pitch
   */
  _findBestMatch(pitch, currentTime) {
    let bestIndex = -1;
    let bestDelta = Infinity;

    for (let i = 0; i < this.chart.notes.length; i++) {
      // Skip already judged notes
      if (this.noteStates[i] !== NoteState.UPCOMING &&
          this.noteStates[i] !== NoteState.ACTIVE) {
        continue;
      }

      const note = this.chart.notes[i];

      // Must match pitch
      if (note.pitch !== pitch) continue;

      const delta = currentTime - note.time;
      const absDelta = Math.abs(delta);

      // Must be within the maximum hit window
      if (absDelta > HIT_WINDOWS.miss) continue;

      // Take the closest match
      if (absDelta < Math.abs(bestDelta)) {
        bestIndex = i;
        bestDelta = delta;
      }
    }

    return bestIndex >= 0 ? { index: bestIndex, delta: bestDelta } : null;
  }

  /**
   * Check for notes that have passed the hit window without being played
   */
  _checkMissedNotes() {
    for (let i = 0; i < this.chart.notes.length; i++) {
      if (this.noteStates[i] !== NoteState.UPCOMING &&
          this.noteStates[i] !== NoteState.ACTIVE) {
        continue;
      }

      const note = this.chart.notes[i];
      const delta = this.currentTime - note.time;

      if (delta > HIT_WINDOWS.miss) {
        this.noteStates[i] = NoteState.MISSED;
        this.hitCounts.miss++;

        if (this.combo > 0) {
          this.onComboBreak?.(this.combo);
        }
        this.combo = 0;
        this.multiplier = 1;

        this.onMiss?.(i);
      } else if (delta > -this.scrollSpeed) {
        // Note is now in the active zone
        this.noteStates[i] = NoteState.ACTIVE;
      }
    }
  }

  /**
   * Update score multiplier based on combo
   */
  _updateMultiplier() {
    this.multiplier = 1;
    for (const threshold of COMBO_MULTIPLIER_THRESHOLDS) {
      if (this.combo >= threshold) {
        this.multiplier++;
      }
    }
  }

  _resetScore() {
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.multiplier = 1;
    this.hitCounts = { perfect: 0, great: 0, good: 0, miss: 0 };
  }

  _setState(newState) {
    const old = this.state;
    this.state = newState;
    this.onStateChange?.(newState, old);
  }

  /**
   * Get results summary
   */
  getResults() {
    const total = this.chart?.noteCount || 0;
    const hit = this.hitCounts.perfect + this.hitCounts.great + this.hitCounts.good;
    const accuracy = total > 0 ? (hit / total) * 100 : 0;

    let grade;
    if (accuracy >= 98 && this.hitCounts.miss === 0) grade = 'S';
    else if (accuracy >= 95) grade = 'A';
    else if (accuracy >= 85) grade = 'B';
    else if (accuracy >= 70) grade = 'C';
    else if (accuracy >= 50) grade = 'D';
    else grade = 'F';

    return {
      score: this.score,
      grade,
      accuracy: Math.round(accuracy * 10) / 10,
      maxCombo: this.maxCombo,
      totalNotes: total,
      ...this.hitCounts,
    };
  }

  /**
   * Reset for a new game
   */
  reset() {
    if (this._countdownInterval) clearInterval(this._countdownInterval);
    this.state = GameState.MENU;
    this.currentTime = 0;
    this.startTimestamp = 0;
    this.pauseOffset = 0;
    this._resetScore();
    if (this.chart) {
      this.noteStates = this.chart.notes.map(() => NoteState.UPCOMING);
    }
  }
}
