/**
 * Piano Hero — Main entry point
 * Wires together MIDI, game engine, renderer, and diagnostics.
 */

import { MidiEngine } from './midi-engine.js';
import { GameEngine, GameState } from './game-engine.js';
import { Renderer } from './renderer.js';
import { MidiDiagnostics } from './midi-diagnostics.js';
import { parseMidiFile, generateDemoChart } from './chart-parser.js';

// ─── Application State ───────────────────────────────────────────

const midi = new MidiEngine();
const game = new GameEngine();
let renderer = null;
let diagnostics = null;
let animationId = null;
let currentScreen = 'menu';

const $ = (sel) => document.querySelector(sel);

// ─── Initialize ──────────────────────────────────────────────────

async function init() {
  const canvas = $('#game-canvas');
  renderer = new Renderer(canvas);

  // Initialize MIDI
  try {
    const { inputs } = await midi.init();
    updateDeviceList(inputs);
    const status = $('#midi-status');
    const dot = $('#midi-dot');

    if (inputs.length > 0) {
      status.textContent = `${inputs.length} device(s) found`;
      dot.className = 'midi-dot connected';
      midi.autoConnect();
      if (midi.selectedInput) {
        status.textContent = `Connected: ${midi.selectedInput.name}`;
        $('#device-select').value = midi.selectedInput.id;
      }
    } else {
      status.textContent = 'No MIDI devices detected — connect piano and refresh';
      dot.className = 'midi-dot disconnected';
    }
  } catch (err) {
    $('#midi-status').textContent = err.message;
    $('#midi-dot').className = 'midi-dot error';
  }

  // Wire MIDI → game + renderer + diagnostics
  midi.onNoteOn = (note, velocity, channel, timestamp) => {
    renderer.pressKey(note);
    game.handleNoteOn(note, velocity, timestamp);
    diagnostics?.noteOn(note, velocity, channel, timestamp);
  };

  midi.onNoteOff = (note, channel, timestamp) => {
    renderer.releaseKey(note);
    game.handleNoteOff(note, timestamp);
    diagnostics?.noteOff(note, channel, timestamp);
  };

  midi.onPedal = (type, value, channel, timestamp) => {
    diagnostics?.pedalChange(type, value, channel, timestamp);
  };

  midi.onRawMessage = (data, timestamp) => {
    diagnostics?.rawMessage(data, timestamp);
  };

  midi.onDeviceChange = (inputs) => {
    updateDeviceList(inputs);
    const dot = $('#midi-dot');
    const status = $('#midi-status');
    if (inputs.length > 0) {
      dot.className = 'midi-dot connected';
      if (!midi.selectedInput) {
        midi.autoConnect();
        if (midi.selectedInput) {
          status.textContent = `Connected: ${midi.selectedInput.name}`;
          $('#device-select').value = midi.selectedInput.id;
        }
      }
    } else {
      dot.className = 'midi-dot disconnected';
      status.textContent = 'No MIDI devices';
    }
  };

  // Wire game events → renderer
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
  $('#device-select')?.addEventListener('change', (e) => {
    if (!e.target.value) return;
    midi.connectInput(e.target.value);
    const matchOutput = midi.outputs.find(
      (o) => o.name === midi.selectedInput?.name
    );
    if (matchOutput) midi.connectOutput(matchOutput.id);
    $('#midi-status').textContent = `Connected: ${midi.selectedInput.name}`;
    $('#midi-dot').className = 'midi-dot connected';
  });

  // Load MIDI file
  $('#load-midi')?.addEventListener('click', () => $('#midi-file')?.click());
  $('#midi-file')?.addEventListener('change', handleMidiFileLoad);

  // Play demo
  $('#play-demo')?.addEventListener('click', () => {
    const chart = generateDemoChart();
    startGame(chart);
  });

  // MIDI Test button
  $('#test-midi')?.addEventListener('click', () => showScreen('diagnostics'));
  $('#diag-back')?.addEventListener('click', () => showScreen('menu'));
  $('#diag-reset')?.addEventListener('click', () => diagnostics?.resetStats());

  // Settings
  $('#latency-offset')?.addEventListener('input', (e) => {
    game.latencyOffset = parseInt(e.target.value) || 0;
    $('#latency-value').textContent = `${e.target.value}ms`;
  });

  $('#scroll-speed')?.addEventListener('input', (e) => {
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
        if (currentScreen === 'diagnostics') showScreen('menu');
        break;
    }
  });

  // Click to restart from results
  $('#game-canvas')?.addEventListener('click', () => {
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

  // FIX: resize renderer AFTER game-screen becomes visible
  // Without this, canvas has 0×0 dimensions and renders black
  requestAnimationFrame(() => {
    renderer.resize();
    game.start();
  });
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
      break;

    case GameState.RESULTS:
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
      return; // Stop loop
    }

    animationId = requestAnimationFrame(frame);
  }

  animationId = requestAnimationFrame(frame);
}

// ─── Screen Management ───────────────────────────────────────────

function showScreen(screen) {
  currentScreen = screen;
  $('#menu-screen').classList.toggle('hidden', screen !== 'menu');
  $('#game-screen').classList.toggle('hidden', screen !== 'game');
  $('#diag-screen').classList.toggle('hidden', screen !== 'diagnostics');

  if (screen === 'diagnostics') {
    if (!diagnostics) {
      diagnostics = new MidiDiagnostics($('#diag-container'));
    }
    diagnostics.init();
  }
}

// ─── UI Helpers ──────────────────────────────────────────────────

function updateDeviceList(inputs) {
  const sel = $('#device-select');
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = '<option value="">Select MIDI device...</option>';
  inputs.forEach((d) => {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = `${d.name}${d.isDisklavier ? ' ★ Disklavier' : ''}`;
    sel.appendChild(opt);
  });
  if (prev) sel.value = prev;
}

// ─── Boot ────────────────────────────────────────────────────────

init().catch((err) => {
  console.error('Piano Hero initialization failed:', err);
});
