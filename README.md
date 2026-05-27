# Piano Hero — Disklavier Edition

A Guitar Hero-style rhythm game designed for the **Yamaha DC2X ENST Disklavier ENSPIRE ST** baby grand piano. Notes fall down a piano-roll display and you play them on the real piano — the game scores your timing, accuracy, and dynamics.

## Requirements

- **Browser**: Chrome or Edge (Web MIDI API support required)
- **MIDI Device**: Yamaha Disklavier DC2X ENSPIRE ST connected via USB, or any MIDI keyboard
- **Node.js**: v18+ (for the dev server)

## Quick Start

```bash
# Install dependencies
npm install

# Start the development server
npm run dev
```

Open the URL shown in terminal (usually `http://localhost:5173`). The app will auto-detect your Disklavier via USB MIDI.

## How to Play

1. Connect your Disklavier (or any MIDI keyboard) via USB
2. Open Piano Hero in Chrome/Edge
3. Select your MIDI device from the dropdown (auto-detected if Yamaha)
4. Load a MIDI file or click **Demo** to try the built-in chart
5. Notes fall towards the hit line — play them when they reach the line
6. Earn Perfect/Great/Good ratings based on timing accuracy

### Controls

| Key     | Action              |
|---------|---------------------|
| SPACE   | Pause / Resume      |
| ESC     | Back to menu        |

### Scoring

- **Perfect** (±30ms): 100 pts × multiplier
- **Great** (±60ms): 75 pts × multiplier
- **Good** (±100ms): 50 pts × multiplier
- **Miss**: 0 pts, combo breaks

Combo multiplier increases at 10, 25, 50, and 100 consecutive hits (up to 5×).

### Difficulty Levels

- **Easy**: Melody only — just the top notes
- **Medium**: Melody + bass line
- **Hard**: Full arrangement, all notes
- **Expert**: Every note + velocity matching (dynamics scored)

## Project Structure

```
piano-hero/
├── index.html              # Main HTML with UI and styles
├── package.json            # Dependencies and scripts
├── README.md
└── src/
    ├── main.js             # App entry point, wires everything together
    ├── midi-engine.js      # Web MIDI API interface (input/output)
    ├── chart-parser.js     # MIDI file → game chart converter
    ├── game-engine.js      # Timing judge, scoring, game state
    └── renderer.js         # Canvas rendering (notes, keyboard, HUD)
```

## Architecture

```
Disklavier ──USB MIDI──► midi-engine.js ──events──► game-engine.js
                              ▲                          │
                              │                     scoring/state
                         MIDI output                     │
                        (auto-play)                      ▼
                                                   renderer.js ──► Canvas
```

### Module Responsibilities

**midi-engine.js** — Handles all Web MIDI API communication. Detects devices, parses Note On/Off and Control Change messages, tracks active notes and pedal state. Can also send MIDI back to the Disklavier for auto-play features.

**chart-parser.js** — Converts standard MIDI files into the game's internal chart format using `@tonejs/midi`. Supports difficulty filtering (melody extraction, bass+melody, full arrangement). Also generates a built-in demo chart for testing.

**game-engine.js** — Core game logic. Manages the game state machine (menu → countdown → playing → paused → results). The timing judge compares player input against chart notes with configurable hit windows. Handles scoring with combos and multipliers.

**renderer.js** — Canvas 2D rendering engine. Draws the falling notes (color-coded by hand), an 88-key piano keyboard with press feedback, hit line, judgment animations, particle effects, and the HUD with score/combo/progress.

## Disklavier-Specific Features

The DC2X ENSPIRE ST is a reproducing piano — it can physically move its keys via MIDI output. This enables features not possible with a regular MIDI keyboard:

- **Tutorial Mode**: Send notes to the piano so it plays the passage first, then the player tries
- **Ghost Notes**: The piano plays notes the player missed in real time
- **Replay**: Record the player's performance and replay it on the physical piano
- **Duet Mode**: Player takes one hand, piano auto-plays the other

These features use `midi-engine.js`'s `sendNoteOn()`, `sendNoteOff()`, and `playSequence()` methods.

## Configuration

### Latency Offset

USB MIDI introduces a small latency. Use the Latency Offset slider (-100ms to +100ms) to compensate. A positive value means your input is registered earlier than it actually arrives.

### Scroll Speed

Controls how many seconds of upcoming notes are visible (1s–6s). Lower values = notes move faster = harder to read. Higher values = more time to prepare.

## Loading Songs

Piano Hero accepts standard MIDI files (`.mid`, `.midi`). Good sources for piano MIDI files:

- Your own recordings from the Disklavier (it can export MIDI)
- Classical piano MIDI archives
- MIDI files from digital music stores

The chart parser extracts all tracks and merges them, then applies the selected difficulty filter.

## Development

```bash
npm run dev      # Dev server with hot reload
npm run build    # Production build to dist/
npm run preview  # Preview production build
```

### Adding Features

To add a new game mode or visual effect:

1. Game logic goes in `game-engine.js`
2. Visual rendering goes in `renderer.js`
3. Wire them together in `main.js`
4. MIDI I/O goes through `midi-engine.js`

## Tech Stack

- **Vite** — Dev server and bundler
- **@tonejs/midi** — MIDI file parsing
- **Web MIDI API** — Browser MIDI access
- **Canvas 2D** — Rendering

No frameworks — vanilla JavaScript with ES modules for simplicity and performance.

## Browser Compatibility

Web MIDI API is supported in:
- Google Chrome (desktop)
- Microsoft Edge (desktop)
- Opera

Not supported in Firefox or Safari (as of 2026).

## License

MIT
