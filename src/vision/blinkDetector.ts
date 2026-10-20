/**
 * Blink detection from a per-frame eye-openness signal.
 *
 * Signal: the Eye Aspect Ratio (EAR, Soukupova & Cech 2016) computed from six eye landmarks
 *
 *     EAR = (|p2 - p6| + |p3 - p5|) / (2 * |p1 - p4|)
 *
 * p1/p4 are the horizontal eye corners, p2/p3 the upper-lid points and p6/p5 the lower-lid
 * points. An open eye is typically ~0.25-0.35; a closed eye drops towards ~0.05-0.15.
 *
 * Method: exponential smoothing + a three-phase state machine with hysteresis:
 *
 *     unknown -> open -> closed -> open   (counted as ONE blink on the closed -> open edge)
 *
 * Starting-point thresholds are in DEFAULT_BLINK_CONFIG. They are generic values that work for
 * many people but not everyone (eye shape, glasses, camera angle and lighting all matter), so
 * every value is configurable and the detector reports a confidence rather than certainty.
 *
 * Not a liveness or anti-spoofing check: a video of a blinking face produces the same signal.
 */

export interface BlinkConfig {
  /** Smoothed EAR below this value starts a "closed" phase. */
  closeThreshold: number;
  /** Smoothed EAR at or above this value ends a "closed" phase / starts "open". (> closeThreshold: hysteresis) */
  openThreshold: number;
  /** Exponential moving average weight of the newest sample, 0 < alpha <= 1. */
  smoothingAlpha: number;
  /** Closures shorter than this are treated as noise. */
  minClosedMs: number;
  /** Closures longer than this are treated as deliberate eye-closing, not a blink. */
  maxClosedMs: number;
  /** Minimum gap between the end of one blink and the next counted blink. */
  refractoryMs: number;
  /** Per-frame normalised head/face motion above which a closure is discarded. */
  maxMotion: number;
}

export const DEFAULT_BLINK_CONFIG: Readonly<BlinkConfig> = {
  closeThreshold: 0.19,
  openThreshold: 0.23,
  smoothingAlpha: 0.6,
  minClosedMs: 50,
  maxClosedMs: 700,
  refractoryMs: 250,
  maxMotion: 0.04,
};

export type BlinkPhase = 'unknown' | 'open' | 'closed';

export interface BlinkSample {
  timestampMs: number;
  /** Mean EAR of the usable eyes, or null when the face/eyes were not measurable this frame. */
  ear: number | null;
  /** Optional normalised face-centre displacement since the previous frame. */
  motion?: number;
}

export interface BlinkEvent {
  startMs: number;
  endMs: number;
  durationMs: number;
  minEar: number;
  /** 0-1 heuristic: how clearly the EAR dipped below the closing threshold relative to the open baseline. */
  confidence: number;
}

export interface BlinkUpdate {
  phase: BlinkPhase;
  smoothedEar: number | null;
  /** 0 (closed) - 1 (fully open) openness estimate for UI meters. */
  openness: number;
  /** Set only on the frame where a blink is completed. */
  blink: BlinkEvent | null;
  blinkCount: number;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

export class BlinkDetector {
  private readonly cfg: BlinkConfig;
  private phase: BlinkPhase = 'unknown';
  private ema: number | null = null;
  private baseline: number | null = null;
  private closedStartMs = 0;
  private minEar = Infinity;
  private tainted = false;
  private lastBlinkEndMs = -Infinity;
  private count = 0;

  constructor(config: Partial<BlinkConfig> = {}) {
    this.cfg = { ...DEFAULT_BLINK_CONFIG, ...config };
    if (this.cfg.openThreshold <= this.cfg.closeThreshold) {
      throw new RangeError('openThreshold must be greater than closeThreshold (hysteresis).');
    }
    if (this.cfg.smoothingAlpha <= 0 || this.cfg.smoothingAlpha > 1) {
      throw new RangeError('smoothingAlpha must be in (0, 1].');
    }
  }

  get blinkCount(): number {
    return this.count;
  }

  get currentPhase(): BlinkPhase {
    return this.phase;
  }

  /** Forget all temporal state (but not the configuration). Call when the scan restarts. */
  reset(): void {
    this.phase = 'unknown';
    this.ema = null;
    this.baseline = null;
    this.closedStartMs = 0;
    this.minEar = Infinity;
    this.tainted = false;
    this.lastBlinkEndMs = -Infinity;
    this.count = 0;
  }

  update(sample: BlinkSample): BlinkUpdate {
    const { timestampMs, ear } = sample;
    const motion = sample.motion ?? 0;

    // Unmeasurable frame (no face, occlusion, eyes out of frame): never complete a blink across it.
    if (ear === null || !Number.isFinite(ear)) {
      this.phase = 'unknown';
      this.ema = null;
      this.tainted = false;
      this.minEar = Infinity;
      return this.snapshot(null);
    }

    this.ema = this.ema === null ? ear : this.cfg.smoothingAlpha * ear + (1 - this.cfg.smoothingAlpha) * this.ema;
    const smoothed = this.ema;
    let blink: BlinkEvent | null = null;

    switch (this.phase) {
      case 'unknown':
        if (smoothed >= this.cfg.openThreshold) {
          this.phase = 'open';
          this.baseline = smoothed;
        }
        break;

      case 'open':
        if (smoothed < this.cfg.closeThreshold) {
          this.phase = 'closed';
          this.closedStartMs = timestampMs;
          this.minEar = smoothed;
          this.tainted = motion > this.cfg.maxMotion;
        } else {
          // Slowly track the person's own open-eye level (used only for confidence).
          this.baseline = this.baseline === null ? smoothed : 0.97 * this.baseline + 0.03 * smoothed;
        }
        break;

      case 'closed':
        this.minEar = Math.min(this.minEar, smoothed);
        if (motion > this.cfg.maxMotion) this.tainted = true;
        if (smoothed >= this.cfg.openThreshold) {
          const durationMs = timestampMs - this.closedStartMs;
          const valid =
            !this.tainted &&
            durationMs >= this.cfg.minClosedMs &&
            durationMs <= this.cfg.maxClosedMs &&
            timestampMs - this.lastBlinkEndMs >= this.cfg.refractoryMs;
          if (valid) {
            blink = {
              startMs: this.closedStartMs,
              endMs: timestampMs,
              durationMs,
              minEar: this.minEar,
              confidence: this.confidence(this.minEar),
            };
            this.count += 1;
            this.lastBlinkEndMs = timestampMs;
          }
          this.phase = 'open';
          this.baseline = smoothed;
          this.tainted = false;
          this.minEar = Infinity;
        }
        break;
    }

    return this.snapshot(blink);
  }

  private confidence(minEar: number): number {
    const base = this.baseline ?? this.cfg.openThreshold + 0.05;
    const span = Math.max(0.05, base - this.cfg.closeThreshold);
    // Dip depth below the closing threshold, scaled by how far the open baseline sits above it.
    return clamp01(0.5 + (this.cfg.closeThreshold - minEar) / span);
  }

  private snapshot(blink: BlinkEvent | null): BlinkUpdate {
    const lo = this.cfg.closeThreshold * 0.5;
    const hi = this.cfg.openThreshold * 1.3;
    const openness = this.ema === null ? 0 : clamp01((this.ema - lo) / (hi - lo));
    return { phase: this.phase, smoothedEar: this.ema, openness, blink, blinkCount: this.count };
  }
}
