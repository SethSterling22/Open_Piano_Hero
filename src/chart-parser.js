/**
 * Chart Parser — Converts MIDI files into game charts
 *
 * A "chart" is the game's internal representation of a song:
 * - Ordered list of notes with exact timing
 * - Metadata (title, BPM, duration)
 * - Difficulty filtering
 *
 * Uses @tonejs/midi to parse Standard MIDI Files
 */

import { Midi } from '@tonejs/midi';

/**
 * Difficulty presets — define which notes to include
 */
const DIFFICULTY = {
  easy: {
    label: 'Easy',
    description: 'Melody only, simplified rhythm',
    filter: (notes) => filterMelody(notes),
  },
  medium: {
    label: 'Medium',
    description: 'Melody + basic chords',
    filter: (notes) => filterMedium(notes),
  },
  hard: {
    label: 'Hard',
    description: 'Full arrangement',
    filter: (notes) => notes,
  },
  expert: {
    label: 'Expert',
    description: 'Every note, exact velocity',
    filter: (notes) => notes,
    matchVelocity: true,
  },
};

/**
 * Parse a MIDI file (ArrayBuffer) into a Chart object
 */
export function parseMidiFile(arrayBuffer, options = {}) {
  const midi = new Midi(arrayBuffer);
  const difficulty = options.difficulty || 'hard';

  // Extract all notes from all tracks
  let allNotes = [];

  midi.tracks.forEach((track, trackIndex) => {
    track.notes.forEach((note) => {
      allNotes.push({
        id: `${trackIndex}-${note.ticks}`,
        pitch: note.midi,          // MIDI note number (0-127)
        name: note.name,           // e.g., "C4"
        time: note.time,           // Start time in seconds
        duration: note.duration,   // Duration in seconds
        velocity: note.velocity,   // 0.0 - 1.0
        track: trackIndex,
        // Heuristic: lower notes are likely left hand
        hand: note.midi < 60 ? 'left' : 'right',
      });
    });
  });

  // Sort by time, then by pitch
  allNotes.sort((a, b) => a.time - b.time || a.pitch - b.pitch);

  // Apply difficulty filter
  const diffConfig = DIFFICULTY[difficulty] || DIFFICULTY.hard;
  const filteredNotes = diffConfig.filter(allNotes);

  // Assign sequential IDs
  filteredNotes.forEach((note, i) => {
    note.id = i;
  });

  // Extract tempo information
  const tempos = midi.header.tempos;
  const bpm = tempos.length > 0 ? Math.round(tempos[0].bpm) : 120;

  // Calculate total duration
  const totalDuration =
    allNotes.length > 0
      ? Math.max(...allNotes.map((n) => n.time + n.duration))
      : 0;

  return {
    title: midi.header.name || options.title || 'Untitled',
    bpm,
    difficulty,
    matchVelocity: diffConfig.matchVelocity || false,
    totalDuration,
    noteCount: filteredNotes.length,
    notes: filteredNotes,
    tempos: midi.header.tempos,
    timeSignatures: midi.header.timeSignatures,
    // Keep reference to raw MIDI for playback
    _midi: midi,
  };
}

/**
 * Parse a JSON chart file (our custom format)
 */
export function parseJsonChart(json) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;

  const notes = data.notes.map((n, i) => ({
    id: i,
    pitch: n.pitch,
    name: midiToName(n.pitch),
    time: n.time,
    duration: n.duration || 0.25,
    velocity: n.velocity || 0.8,
    hand: n.hand || (n.pitch < 60 ? 'left' : 'right'),
  }));

  return {
    title: data.title || 'Untitled',
    bpm: data.bpm || 120,
    difficulty: data.difficulty || 'medium',
    matchVelocity: data.matchVelocity || false,
    totalDuration: Math.max(...notes.map((n) => n.time + n.duration)),
    noteCount: notes.length,
    notes,
    tempos: [{ bpm: data.bpm || 120, ticks: 0 }],
    timeSignatures: [{ timeSignature: [4, 4], ticks: 0 }],
  };
}

/**
 * Generate a demo chart for testing (C major scale + chords)
 */
export function generateDemoChart() {
  const bpm = 100;
  const beatDuration = 60 / bpm;
  const notes = [];
  let time = 2; // 2 second lead-in

  // C major scale ascending
  const scale = [60, 62, 64, 65, 67, 69, 71, 72];
  scale.forEach((pitch, i) => {
    notes.push({
      id: notes.length,
      pitch,
      name: midiToName(pitch),
      time: time + i * beatDuration,
      duration: beatDuration * 0.9,
      velocity: 0.7,
      hand: 'right',
    });
  });

  time += scale.length * beatDuration + beatDuration;

  // C major scale descending
  [...scale].reverse().forEach((pitch, i) => {
    notes.push({
      id: notes.length,
      pitch,
      name: midiToName(pitch),
      time: time + i * beatDuration,
      duration: beatDuration * 0.9,
      velocity: 0.7,
      hand: 'right',
    });
  });

  time += scale.length * beatDuration + beatDuration;

  // Simple chords: C - F - G - C
  const chords = [
    [48, 52, 55],  // C major
    [53, 57, 60],  // F major
    [43, 47, 50],  // G major
    [48, 52, 55],  // C major
  ];

  chords.forEach((chord, i) => {
    chord.forEach((pitch) => {
      notes.push({
        id: notes.length,
        pitch,
        name: midiToName(pitch),
        time: time + i * beatDuration * 2,
        duration: beatDuration * 1.8,
        velocity: 0.75,
        hand: pitch < 60 ? 'left' : 'right',
      });
    });
  });

  return {
    title: 'Demo — C Major Scale & Chords',
    bpm,
    difficulty: 'easy',
    matchVelocity: false,
    totalDuration: time + 8 * beatDuration + 2,
    noteCount: notes.length,
    notes,
    tempos: [{ bpm, ticks: 0 }],
    timeSignatures: [{ timeSignature: [4, 4], ticks: 0 }],
  };
}

// ─── Difficulty Filters ──────────────────────────────────────────

/**
 * Extract only the melody (highest note at each time point)
 */
function filterMelody(notes) {
  const grouped = groupByTimeWindow(notes, 0.05);
  return grouped.map((group) =>
    group.reduce((highest, note) =>
      note.pitch > highest.pitch ? note : highest
    )
  );
}

/**
 * Medium difficulty — melody + bass notes
 */
function filterMedium(notes) {
  const grouped = groupByTimeWindow(notes, 0.05);
  const result = [];

  grouped.forEach((group) => {
    // Keep highest (melody) and lowest (bass)
    const sorted = [...group].sort((a, b) => a.pitch - b.pitch);
    result.push(sorted[sorted.length - 1]); // melody
    if (sorted.length > 1 && sorted[0].pitch < 60) {
      result.push(sorted[0]); // bass
    }
  });

  return result.sort((a, b) => a.time - b.time);
}

/**
 * Group notes that occur within a time window
 */
function groupByTimeWindow(notes, windowSec) {
  if (notes.length === 0) return [];

  const groups = [[notes[0]]];
  for (let i = 1; i < notes.length; i++) {
    const lastGroup = groups[groups.length - 1];
    if (notes[i].time - lastGroup[0].time < windowSec) {
      lastGroup.push(notes[i]);
    } else {
      groups.push([notes[i]]);
    }
  }
  return groups;
}

// ─── Helpers ─────────────────────────────────────────────────────

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function midiToName(midi) {
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[midi % 12]}${octave}`;
}
