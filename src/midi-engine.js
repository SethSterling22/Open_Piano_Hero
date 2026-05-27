/**
 * MIDI Engine — Web MIDI API interface for Yamaha Disklavier DC2X ENSPIRE ST
 *
 * Handles:
 * - MIDI device detection and connection
 * - Note On/Off event parsing
 * - Control Change (pedals) parsing
 * - Sending MIDI back to the Disklavier (auto-play features)
 */

// MIDI message types
const MSG = {
  NOTE_OFF: 0x80,
  NOTE_ON: 0x90,
  CONTROL_CHANGE: 0xB0,
};

// Common Control Change numbers
const CC = {
  SUSTAIN_PEDAL: 64,
  SOSTENUTO_PEDAL: 66,
  SOFT_PEDAL: 67,
};

// Note names for display
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function noteName(midiNote) {
  const octave = Math.floor(midiNote / 12) - 1;
  return `${NOTE_NAMES[midiNote % 12]}${octave}`;
}

export function isBlackKey(midiNote) {
  const n = midiNote % 12;
  return [1, 3, 6, 8, 10].includes(n);
}

export class MidiEngine {
  constructor() {
    this.midiAccess = null;
    this.selectedInput = null;
    this.selectedOutput = null;
    this.inputs = [];
    this.outputs = [];

    // Event callbacks
    this.onNoteOn = null;   // (note, velocity, channel, timestamp) => {}
    this.onNoteOff = null;  // (note, channel, timestamp) => {}
    this.onPedal = null;    // (pedalType, value, channel, timestamp) => {}
    this.onDeviceChange = null; // (inputs, outputs) => {}
    this.onRawMessage = null;   // (data, timestamp) => {} — for diagnostics

    // Active notes tracking
    this.activeNotes = new Set();
    this.pedalState = {
      sustain: false,
      sostenuto: false,
      soft: false,
    };
  }

  /**
   * Initialize Web MIDI API and scan for devices
   */
  async init() {
    if (!navigator.requestMIDIAccess) {
      throw new Error(
        'Web MIDI API not supported in this browser. Use Chrome or Edge.'
      );
    }

    try {
      this.midiAccess = await navigator.requestMIDIAccess({ sysex: false });
      this._scanDevices();

      // Listen for device connect/disconnect
      this.midiAccess.onstatechange = () => {
        this._scanDevices();
        this.onDeviceChange?.(this.inputs, this.outputs);
      };

      return { inputs: this.inputs, outputs: this.outputs };
    } catch (err) {
      throw new Error(`MIDI access denied: ${err.message}`);
    }
  }

  /**
   * Scan available MIDI inputs and outputs
   */
  _scanDevices() {
    this.inputs = [];
    this.outputs = [];

    for (const input of this.midiAccess.inputs.values()) {
      this.inputs.push({
        id: input.id,
        name: input.name,
        manufacturer: input.manufacturer,
        port: input,
        isDisklavier: this._isDisklavier(input),
      });
    }

    for (const output of this.midiAccess.outputs.values()) {
      this.outputs.push({
        id: output.id,
        name: output.name,
        manufacturer: output.manufacturer,
        port: output,
        isDisklavier: this._isDisklavier(output),
      });
    }
  }

  /**
   * Check if a MIDI port is likely a Disklavier
   */
  _isDisklavier(port) {
    const name = (port.name || '').toLowerCase();
    const mfr = (port.manufacturer || '').toLowerCase();
    return (
      name.includes('disklavier') ||
      name.includes('yamaha') ||
      mfr.includes('yamaha')
    );
  }

  /**
   * Connect to a specific MIDI input device
   */
  connectInput(deviceId) {
    // Disconnect previous
    if (this.selectedInput) {
      this.selectedInput.port.onmidimessage = null;
    }

    const device = this.inputs.find((d) => d.id === deviceId);
    if (!device) throw new Error(`MIDI input device not found: ${deviceId}`);

    this.selectedInput = device;
    device.port.onmidimessage = (event) => this._handleMidiMessage(event);
    console.log(`[MIDI] Connected input: ${device.name}`);
    return device;
  }

  /**
   * Connect to a specific MIDI output device (for sending to Disklavier)
   */
  connectOutput(deviceId) {
    const device = this.outputs.find((d) => d.id === deviceId);
    if (!device) throw new Error(`MIDI output device not found: ${deviceId}`);

    this.selectedOutput = device;
    console.log(`[MIDI] Connected output: ${device.name}`);
    return device;
  }

  /**
   * Auto-detect and connect to the first Disklavier found (or first device)
   */
  autoConnect() {
    // Prefer Disklavier, fall back to first available
    const input =
      this.inputs.find((d) => d.isDisklavier) || this.inputs[0];
    const output =
      this.outputs.find((d) => d.isDisklavier) || this.outputs[0];

    if (input) this.connectInput(input.id);
    if (output) this.connectOutput(output.id);

    return { input, output };
  }

  /**
   * Parse incoming MIDI messages
   */
  _handleMidiMessage(event) {
    const [status, data1, data2] = event.data;
    const msgType = status & 0xf0;
    const channel = status & 0x0f;
    const timestamp = event.timeStamp;

    // Raw message callback for diagnostics
    this.onRawMessage?.(event.data, timestamp);

    switch (msgType) {
      case MSG.NOTE_ON:
        if (data2 > 0) {
          // Note On
          this.activeNotes.add(data1);
          this.onNoteOn?.(data1, data2, channel, timestamp);
        } else {
          // Note On with velocity 0 = Note Off
          this.activeNotes.delete(data1);
          this.onNoteOff?.(data1, channel, timestamp);
        }
        break;

      case MSG.NOTE_OFF:
        this.activeNotes.delete(data1);
        this.onNoteOff?.(data1, channel, timestamp);
        break;

      case MSG.CONTROL_CHANGE:
        this._handleControlChange(data1, data2, channel, timestamp);
        break;
    }
  }

  /**
   * Handle Control Change messages (pedals, etc.)
   */
  _handleControlChange(cc, value, channel, timestamp) {
    const isOn = value >= 64;

    switch (cc) {
      case CC.SUSTAIN_PEDAL:
        this.pedalState.sustain = isOn;
        this.onPedal?.('sustain', value, channel, timestamp);
        break;
      case CC.SOSTENUTO_PEDAL:
        this.pedalState.sostenuto = isOn;
        this.onPedal?.('sostenuto', value, channel, timestamp);
        break;
      case CC.SOFT_PEDAL:
        this.pedalState.soft = isOn;
        this.onPedal?.('soft', value, channel, timestamp);
        break;
    }
  }

  // ─── Output: Send MIDI to Disklavier ───────────────────────────

  /**
   * Send a Note On to the Disklavier (makes the key physically move)
   */
  sendNoteOn(note, velocity = 80, channel = 0) {
    if (!this.selectedOutput) return;
    this.selectedOutput.port.send([MSG.NOTE_ON | channel, note, velocity]);
  }

  /**
   * Send a Note Off to the Disklavier
   */
  sendNoteOff(note, channel = 0) {
    if (!this.selectedOutput) return;
    this.selectedOutput.port.send([MSG.NOTE_OFF | channel, note, 0]);
  }

  /**
   * Play a sequence of notes on the Disklavier (for demo/tutorial mode)
   * @param {Array} notes - [{note, velocity, startTime, duration}]
   */
  playSequence(notes) {
    const startedAt = performance.now();
    const timers = [];

    for (const n of notes) {
      const onTimer = setTimeout(() => {
        this.sendNoteOn(n.note, n.velocity || 80);
      }, n.startTime * 1000);

      const offTimer = setTimeout(() => {
        this.sendNoteOff(n.note);
      }, (n.startTime + n.duration) * 1000);

      timers.push(onTimer, offTimer);
    }

    return {
      cancel: () => timers.forEach(clearTimeout),
      startedAt,
    };
  }

  /**
   * Send All Notes Off (panic)
   */
  allNotesOff(channel = 0) {
    if (!this.selectedOutput) return;
    // CC 123 = All Notes Off
    this.selectedOutput.port.send([MSG.CONTROL_CHANGE | channel, 123, 0]);
    this.activeNotes.clear();
  }

  /**
   * Disconnect and clean up
   */
  disconnect() {
    if (this.selectedInput) {
      this.selectedInput.port.onmidimessage = null;
      this.selectedInput = null;
    }
    this.selectedOutput = null;
    this.activeNotes.clear();
    this.pedalState = { sustain: false, sostenuto: false, soft: false };
  }
}
