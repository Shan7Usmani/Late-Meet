/**
 * @description Options for configuring the VoiceActivityTracker
 * @property {number} rmsThreshold - The minimum RMS (Root Mean Square) level to detect speech
 */
export interface VoiceActivityTrackerOptions {
  rmsThreshold: number;
}

/**
 * @description Tracks voice activity in audio by monitoring RMS levels above a threshold
 * @example
 *   const tracker = new VoiceActivityTracker({ rmsThreshold: 0.1 });
 *   tracker.observe(0.15); // Speech detected
 *   const shouldFlush = tracker.consumeShouldFlush(); // returns true
 */
export class VoiceActivityTracker {
  private readonly rmsThreshold: number;
  private speechObserved = false;

  constructor(options: VoiceActivityTrackerOptions) {
    this.rmsThreshold = options.rmsThreshold;
  }

  observe(rms: number) {
    if (Number.isFinite(rms) && rms >= this.rmsThreshold) {
      this.speechObserved = true;
    }
  }

  consumeShouldFlush() {
    const shouldFlush = this.speechObserved;
    this.speechObserved = false;
    return shouldFlush;
  }
}

/**
 * @description Options for configuring the AdaptiveNoiseGate
 * @property {number} initialThreshold - Starting noise floor estimate (default 0.012)
 * @property {number} adaptationRate - How fast the noise floor adapts during silence (0-1, default 0.01)
 * @property {number} thresholdMultiplier - Multiplier from noise floor to gate threshold (default 2.0)
 * @property {number} minThreshold - Minimum gate threshold (default 0.003)
 * @property {number} maxThreshold - Maximum gate threshold (default 0.05)
 * @property {number} holdFrames - Frames to keep gate open after last speech frame (default 2)
 */
export interface NoiseGateOptions {
  initialThreshold?: number;
  adaptationRate?: number;
  thresholdMultiplier?: number;
  minThreshold?: number;
  maxThreshold?: number;
  holdFrames?: number;
}

/**
 * @description Dynamically estimates the background noise floor from incoming RMS
 * samples and computes an adaptive gate threshold. During silence the noise floor
 * slowly tracks the observed RMS; during speech it decays very gradually so the
 * gate stays responsive when ambient noise drops.
 *
 * A hold counter prevents the gate from chattering during short inter-word pauses.
 *
 * @example
 *   const gate = new AdaptiveNoiseGate({ initialThreshold: 0.012 });
 *   gate.analyze(0.008); // returns adaptive threshold (~0.012)
 *   gate.tick();         // returns true (gate still held open)
 */
export class AdaptiveNoiseGate {
  private noiseFloor: number;
  private readonly adaptationRate: number;
  private readonly thresholdMultiplier: number;
  private readonly minThreshold: number;
  private readonly maxThreshold: number;
  private readonly holdFrames: number;
  private readonly initialThreshold: number;
  private holdCounter: number;

  constructor(options: NoiseGateOptions = {}) {
    this.initialThreshold = options.initialThreshold ?? 0.012;
    this.noiseFloor = this.initialThreshold;
    this.adaptationRate = options.adaptationRate ?? 0.01;
    this.thresholdMultiplier = options.thresholdMultiplier ?? 2.0;
    this.minThreshold = options.minThreshold ?? 0.003;
    this.maxThreshold = options.maxThreshold ?? 0.05;
    this.holdFrames = options.holdFrames ?? 2;
    this.holdCounter = 0;
  }

  /**
   * Feed an RMS sample to the estimator and receive the current adaptive
   * threshold. The noise floor is adapted upward during silence frames and
   * left unchanged during speech so it cannot asymptotically drift toward
   * zero over a long meeting.
   *
   * @returns The current adaptive threshold.
   */
  analyze(rms: number): number {
    const threshold = this.getThreshold();
    const isSpeech = Number.isFinite(rms) && rms >= threshold;

    if (isSpeech) {
      this.holdCounter = this.holdFrames;
      // Noise floor is untouched during speech — it stays at the last
      // silence estimate so it cannot decay toward zero over long meetings.
    } else {
      // Adapt noise floor toward observed RMS during silence
      this.noiseFloor += this.adaptationRate * (rms - this.noiseFloor);
    }

    return threshold;
  }

  /**
   * Decrement the hold counter by one frame. Call this on every VAD tick
   * (even when analysis is throttled) so the hold timer progresses correctly.
   *
   * @returns True while the gate should remain open (hold active).
   */
  tick(): boolean {
    if (this.holdCounter > 0) {
      this.holdCounter--;
      return true;
    }
    return false;
  }

  /** Whether the gate is currently held open after recent speech. */
  get isOpen(): boolean {
    return this.holdCounter > 0;
  }

  /** Returns the current adaptive gate threshold. */
  getThreshold(): number {
    return clamp(this.noiseFloor * this.thresholdMultiplier, this.minThreshold, this.maxThreshold);
  }

  /** Returns the estimated noise floor. */
  getNoiseFloor(): number {
    return this.noiseFloor;
  }

  /** Reset the estimator to its initial state (same constructor options). */
  reset(): void {
    this.noiseFloor = this.initialThreshold;
    this.holdCounter = 0;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * @description Determines the appropriate file extension for an audio MIME type
 * @param {string} mimeType - The MIME type of the audio (e.g., "audio/webm", "audio/mp3")
 * @returns {string} The file extension without the dot (e.g., "webm", "mp3", "ogg")
 * @example
 *   audioFileExtensionForMimeType("audio/webm;codecs=opus") // returns "webm"
 *   audioFileExtensionForMimeType("audio/mpeg") // returns "mp3"
 *   audioFileExtensionForMimeType("application/ogg") // returns "ogg"
 */
export function audioFileExtensionForMimeType(mimeType: string) {
  const normalized = mimeType.split(";")[0].trim().toLowerCase();
  if (normalized.includes("ogg")) return "ogg";
  if (normalized.includes("mp3")) return "mp3";
  if (normalized.includes("mp4")) return "mp4";
  if (normalized.includes("mpeg")) return "mp3";
  if (normalized.includes("wav")) return "wav";
  if (normalized.includes("flac")) return "flac";
  return "webm";
}

/**
 * @description Checks if an audio blob is large enough to be processed (viability check)
 * @param {Blob} blob - The audio blob to validate
 * @param {number} [minBytes=5000] - Minimum size in bytes required for a viable chunk (defaults to 5000)
 * @returns {boolean} True if blob exists and meets minimum size requirement, false otherwise
 * @example
 *   const blob = new Blob([audioData], { type: "audio/webm" });
 *   isChunkViable(blob) // returns true if blob.size >= 5000
 *   isChunkViable(blob, 10000) // returns true if blob.size >= 10000
 */
export function isChunkViable(blob: Blob, minBytes = 5000): boolean {
  return !!blob && blob.size >= minBytes;
}

// Microphone permission handlers
export async function getMicrophoneStream() {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    console.warn("Microphone access denied gracefully catching:", e);
    return null;
  }
}
