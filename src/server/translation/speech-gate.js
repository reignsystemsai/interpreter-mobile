const DEFAULT_SPEECH_GATE_OPTIONS = Object.freeze({
  activationMultiplier: 3.2,
  endSilenceMs: 800,
  frameMs: 20,
  initialNoiseFloor: 250,
  maxZeroCrossingRate: 0.42,
  minRms: 650,
  minSpeechMs: 400,
  minZeroCrossingRate: 0.01,
  preRollMs: 500,
  windowMs: 500
});

function numberFromEnv(name, fallback, minimum, maximum) {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function speechGateOptionsFromEnv() {
  return {
    activationMultiplier: numberFromEnv("INTERPRETER_VAD_ACTIVATION_MULTIPLIER", DEFAULT_SPEECH_GATE_OPTIONS.activationMultiplier, 1.2, 10),
    endSilenceMs: numberFromEnv("INTERPRETER_VAD_END_SILENCE_MS", DEFAULT_SPEECH_GATE_OPTIONS.endSilenceMs, 300, 2000),
    minRms: numberFromEnv("INTERPRETER_VAD_MIN_RMS", DEFAULT_SPEECH_GATE_OPTIONS.minRms, 100, 5000),
    minSpeechMs: numberFromEnv("INTERPRETER_VAD_MIN_SPEECH_MS", DEFAULT_SPEECH_GATE_OPTIONS.minSpeechMs, 200, 1200),
    preRollMs: numberFromEnv("INTERPRETER_VAD_PRE_ROLL_MS", DEFAULT_SPEECH_GATE_OPTIONS.preRollMs, 100, 1000)
  };
}

function pcm16Stats(pcm) {
  if (!Buffer.isBuffer(pcm) || pcm.length < 4 || pcm.length % 2 !== 0) {
    return { rms: 0, zeroCrossingRate: 0 };
  }
  const sampleCount = pcm.length / 2;
  let squaredTotal = 0;
  let crossings = 0;
  let previous = pcm.readInt16LE(0);
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = pcm.readInt16LE(index * 2);
    squaredTotal += sample * sample;
    if (index > 0 && ((sample >= 0) !== (previous >= 0))) crossings += 1;
    previous = sample;
  }
  return {
    rms: Math.sqrt(squaredTotal / sampleCount),
    zeroCrossingRate: crossings / Math.max(1, sampleCount - 1)
  };
}

class SpeechGate {
  constructor(options = {}) {
    this.options = { ...DEFAULT_SPEECH_GATE_OPTIONS, ...options };
    this.noiseFloor = this.options.initialNoiseFloor;
    this.reset();
  }

  reset() {
    this.active = false;
    this.silenceMs = 0;
    this.preRoll = [];
    this.voiceWindow = [];
  }

  push(pcm, { suppressed = false } = {}) {
    if (suppressed) {
      this.reset();
      return { ended: false, frames: [], started: false };
    }

    const stats = pcm16Stats(pcm);
    const activationRms = Math.max(this.options.minRms, this.noiseFloor * this.options.activationMultiplier);
    const voiceLike = stats.rms >= activationRms
      && stats.zeroCrossingRate >= this.options.minZeroCrossingRate
      && stats.zeroCrossingRate <= this.options.maxZeroCrossingRate;

    if (!this.active && !voiceLike) {
      this.noiseFloor = (this.noiseFloor * 0.97) + (Math.min(stats.rms, this.options.minRms) * 0.03);
    }

    this.preRoll.push(Buffer.from(pcm));
    const maxPreRollFrames = Math.ceil(this.options.preRollMs / this.options.frameMs);
    if (this.preRoll.length > maxPreRollFrames) this.preRoll.shift();

    if (!this.active) {
      this.voiceWindow.push(voiceLike);
      const maxWindowFrames = Math.ceil(this.options.windowMs / this.options.frameMs);
      if (this.voiceWindow.length > maxWindowFrames) this.voiceWindow.shift();
      const voicedMs = this.voiceWindow.filter(Boolean).length * this.options.frameMs;
      if (voicedMs < this.options.minSpeechMs) {
        return { ended: false, frames: [], started: false };
      }
      this.active = true;
      this.silenceMs = 0;
      const frames = this.preRoll;
      this.preRoll = [];
      this.voiceWindow = [];
      return { ended: false, frames, started: true };
    }

    this.silenceMs = voiceLike ? 0 : this.silenceMs + this.options.frameMs;
    const ended = this.silenceMs >= this.options.endSilenceMs;
    if (ended) {
      this.active = false;
      this.silenceMs = 0;
      this.preRoll = [];
      this.voiceWindow = [];
    }
    return { ended, frames: [Buffer.from(pcm)], started: false };
  }
}

module.exports = {
  DEFAULT_SPEECH_GATE_OPTIONS,
  SpeechGate,
  pcm16Stats,
  speechGateOptionsFromEnv
};
