/**
 * Piano Hero — Main entry point
 *
 * Wires together all modules and manages the application lifecycle.
 */

import { MidiEngine } from './midi-engine.js';
import { GameEngine, GameState } from './game-engine.js';
import { Renderer } from './renderer.js';
import { parseMidiFile, generateDemoChart } from './chart-parser.js';

// ─── Application State ───────────────────────────────────────────

const midi = new MidiEngine();
const game = new GameEngine();
let renderer = null;
let animationId = null;

// ─── DOM References ──────────────────────────────────────────────

const $ = (sel) => document.querySelector(sel);
const canvas = $('#game-canvas');
const menuScreen = $('#menu-screen');
const gameScreen = $('#game-screen');
const resultsOverlay = $('#results-overlay');
const midiStatus = $('#midi-status');
const deviceSelect = $('#device-select');
const loadMidiBtn = $('#load-midi');
const midiFileInput = $('#midi-file');
const playDemoBtn = $('#play-demo');
const latencyInput = $('#latency-offset');
const scrollSpeedInput = $('#scroll-speed');

// ─── Initialize ──────────────────────────────────────────────────

async function init() {
  renderer = new Renderer(canvas);

  // Initialize MIDI
  try {
    const { inputs, outputs } = await midi.init();
    updateMidiDeviceList(inputs);
    midiStatus.textContent = inputs.length > 0
      ? `${inputs.length} device(s) found`
      : 'No MIDI devices detected';
    midiStatus.className = inputs.length > 0 ? 'status-ok' : 'status-warn';

    // Auto-connect
    if (inputs.length > 0) {
      midi.autoConnect();
      if (midi.selectedInput) {
        midiStatus.textContent = `Connected: ${midi.selectedInput.name}`;
        highlightSelectedDevice(midi.selectedInput.id);
      }
    }
  } catch (err) {
    midiStatus.textContent = err.message;
    midiStatus.className = 'status-error';
  }

  // Wire MIDI events to game engine
  midi.onNoteOn = (note, velocity, channel, timestamp) => {
    renderer.pressKey(note);
    game.handleNoteOn(note, velocity, timestamp);
  };

  midi.onNoteOff = (note, channel, timestamp) => {
    renderer.releaseKey(note);
    game.handleNoteOff(note, timestamp);
  };

  midi.onDeviceChange = (inputs) => {
    updateMidiDeviceList(inputs);
  };

  // Wire game events to renderer
  game.onHit = (noteIndex, judgment, deltaMs) => {
    const note = game.chart.notes[noteIndex];
    renderer.showJudgment(judgment, deltaMs);
    renderer.spawnHitParticles(note.pitch, judgment);
  };

  game.onMiss = (noteIndex) => {
    // Could add a miss visual effect here
  };

  game.onComboBreak = (combo) => {
    if (combo >= 10) {
      renderer.judgmentDisplay = {
        text: 'COMBO BREAK',
        color: '#ff3355',
        time: performance.now(),
      };
    }
  };

  game.onStateChange = (newState, oldState) => {
    handleStateChange(newState, oldState);
  };

  // Bind UI events
  bindEvents();

  // Show menu
  showScreen('menu');
}

// ─── UI Event Binding ────────────────────────────────────────────

function bindEvents() {
  // Device selection
  deviceSelect?.addEventListener('change', (e) => {
    if (e.target.value) {
      midi.connectInput(e.target.value);
      // Also try matching output
      const matchOutput = midi.outputs.find(
        (o) => o.name === midi.selectedInput?.name
      );
      if (matchOutput) midi.connectOutput(matchOutput.id);
    }
  });

  // Load MIDI file
  loadMidiBtn?.addEventListener('click', () => midiFileInput?.click());
  midiFileInput?.addEventListener('change', handleMidiFileLoad);

  // Play demo
  playDemoBtn?.addEventListener('click', () => {
    const chart = generateDemoChart();
    startGame(chart);
  });

  // Settings
  latencyInput?.addEventListener('input', (e) => {
    game.latencyOffset = parseInt(e.target.value) || 0;
    $('#latency-value').textContent = `${e.target.value}ms`;
  });

  scrollSpeedInput?.addEventListener('input', (e) => {
    game.scrollSpeed = parseFloat(e.target.value) || 3;
    $('#speed-value').textContent = `${e.target.value}s`;
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        if (game.state === GameState.PLAYING || game.state === GameState.PAUSED) {
          game.togglePause();
        } else if (game.state === GameState.RESULTS) {
          restartGame();
        }
        break;
      case 'Escape':
        if (game.state === GameState.PLAYING || game.state === GameState.PAUSED) {
          backToMenu();
        }
        break;
    }
  });

  // Click to restart from results
  canvas?.addEventListener('click', () => {
    if (game.state === GameState.RESULTS) {
      restartGame();
    }
  });
}

// ─── MIDI File Loading ───────────────────────────────────────────

async function handleMidiFileLoad(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    const arrayBuffer = await file.arrayBuffer();
    const difficulty = $('#difficulty-select')?.value || 'hard';
    const chart = parseMidiFile(arrayBuffer, {
      title: file.name.replace(/\.mid[i]?$/, ''),
      difficulty,
    });

    console.log(`[Chart] Loaded: ${chart.title}, ${chart.noteCount} notes, ${chart.bpm} BPM`);
    startGame(chart);
  } catch (err) {
    console.error('Failed to parse MIDI file:', err);
    alert(`Error loading MIDI file: ${err.message}`);
  }
}

// ─── Game Flow ───────────────────────────────────────────────────

function startGame(chart) {
  game.reset();
  game.loadChart(chart);
  showScreen('game');
  game.start();
}

function restartGame() {
  if (game.chart) {
    startGame(game.chart);
  }
}

function backToMenu() {
  cancelAnimationFrame(animationId);
  game.reset();
  midi.allNotesOff();
  showScreen('menu');
}

// ─── State Change Handler ────────────────────────────────────────

function handleStateChange(newState, oldState) {
  switch (newState) {
    case GameState.COUNTDOWN:
      startRenderLoop();
      break;

    case GameState.PLAYING:
      break;

    case GameState.PAUSED:
      // Could show pause overlay
      break;

    case GameState.RESULTS:
      // Render results screen
      const results = game.getResults();
      renderer.renderResults(results);
      console.log('[Results]', results);
      break;
  }
}

// ─── Render Loop ─────────────────────────────────────────────────

function startRenderLoop() {
  function frame(timestamp) {
    game.update(timestamp);

    if (game.state === GameState.COUNTDOWN) {
      renderer.renderCountdown(game.countdownRemaining);
    } else if (game.state === GameState.PLAYING) {
      renderer.render(game);
    } else if (game.state === GameState.PAUSED) {
      renderer.render(game);
      // Draw pause overlay
      const ctx = renderer.ctx;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(0, 0, renderer.width, renderer.height);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 36px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('PAUSED', renderer.width / 2, renderer.height / 2);
      ctx.font = '16px "Segoe UI", sans-serif';
      ctx.fillStyle = '#888899';
      ctx.fillText('Press SPACE to resume, ESC to quit', renderer.width / 2, renderer.height / 2 + 40);
    } else if (game.state === GameState.RESULTS) {
      // Results already rendered in state change handler
      return; // Stop loop
    }

    animationId = requestAnimationFrame(frame);
  }

  animationId = requestAnimationFrame(frame);
}

// ─── Screen Management ───────────────────────────────────────────

function showScreen(screen) {
  menuScreen.classList.toggle('hidden', screen !== 'menu');
  gameScreen.classList.toggle('hidden', screen !== 'game');
}

// ─── UI Helpers ──────────────────────────────────────────────────

function updateMidiDeviceList(inputs) {
  if (!deviceSelect) return;
  deviceSelect.innerHTML = '<option value="">Select MIDI device...</option>';
  inputs.forEach((d) => {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = `${d.name}${d.isDisklavier ? ' (Disklavier)' : ''}`;
    deviceSelect.appendChild(opt);
  });
}

function highlightSelectedDevice(deviceId) {
  if (deviceSelect) deviceSelect.value = deviceId;
}

// ─── Boot ────────────────────────────────────────────────────────

init().catch((err) => {
  console.error('Piano Hero initialization failed:', err);
});
