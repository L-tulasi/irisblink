import { describe, expect, it } from 'vitest';
import { BlinkDetector, DEFAULT_BLINK_CONFIG, type BlinkSample } from '../vision/blinkDetector';

const FRAME_MS = 33; // ~30 fps
const OPEN = 0.3;
const CLOSED = 0.08;

/** Builds a sample stream from a list of EAR values at a fixed frame rate. */
function stream(values: Array<number | null>, startMs = 0, motion = 0): BlinkSample[] {
  return values.map((ear, i) => ({ timestampMs: startMs + i * FRAME_MS, ear, motion }));
}

function run(detector: BlinkDetector, samples: BlinkSample[]) {
  return samples.map((s) => detector.update(s));
}

const repeat = (v: number, n: number) => Array<number>(n).fill(v);

describe('BlinkDetector', () => {
  it('counts open -> closed -> open as exactly one blink', () => {
    const d = new BlinkDetector();
    const updates = run(d, stream([...repeat(OPEN, 8), ...repeat(CLOSED, 4), ...repeat(OPEN, 8)]));
    const blinks = updates.filter((u) => u.blink !== null);
    expect(blinks).toHaveLength(1);
    expect(d.blinkCount).toBe(1);
    expect(blinks[0].blink!.durationMs).toBeGreaterThanOrEqual(DEFAULT_BLINK_CONFIG.minClosedMs);
    expect(blinks[0].blink!.confidence).toBeGreaterThan(0.5);
    expect(updates.at(-1)!.phase).toBe('open');
  });

  it('walks through the phases unknown -> open -> closed -> open', () => {
    const d = new BlinkDetector();
    expect(d.currentPhase).toBe('unknown');
    const phases = run(d, stream([...repeat(OPEN, 6), ...repeat(CLOSED, 4), ...repeat(OPEN, 6)])).map((u) => u.phase);
    expect(phases[0]).toBe('open'); // first measurable open sample
    expect(phases).toContain('closed');
    expect(phases.at(-1)).toBe('open');
    expect(phases.indexOf('closed')).toBeGreaterThan(phases.indexOf('open'));
  });

  it('does not double count while the eye stays closed or hovers near the threshold', () => {
    const d = new BlinkDetector();
    // Long closure then noisy reopening inside the hysteresis band (between close and open thresholds).
    const wobble = [0.21, 0.18, 0.21, 0.18, 0.21];
    run(d, stream([...repeat(OPEN, 8), ...repeat(CLOSED, 4), ...wobble, ...repeat(OPEN, 8)]));
    expect(d.blinkCount).toBe(1);
  });

  it('counts two separate blinks separated by the refractory period', () => {
    const d = new BlinkDetector();
    run(
      d,
      stream([
        ...repeat(OPEN, 8),
        ...repeat(CLOSED, 4),
        ...repeat(OPEN, 14), // > refractoryMs of open eye
        ...repeat(CLOSED, 4),
        ...repeat(OPEN, 8),
      ]),
    );
    expect(d.blinkCount).toBe(2);
  });

  it('ignores a one-frame dip shorter than minClosedMs', () => {
    const d = new BlinkDetector({ smoothingAlpha: 1, minClosedMs: 60 });
    run(d, stream([...repeat(OPEN, 8), CLOSED, ...repeat(OPEN, 8)]));
    expect(d.blinkCount).toBe(0);
  });

  it('does not count a deliberate long eye closure', () => {
    const d = new BlinkDetector();
    run(d, stream([...repeat(OPEN, 8), ...repeat(CLOSED, 40), ...repeat(OPEN, 8)])); // ~1.3 s closed
    expect(d.blinkCount).toBe(0);
  });

  it('never completes a blink across an unmeasurable (occluded / no-face) frame', () => {
    const d = new BlinkDetector();
    run(d, stream([...repeat(OPEN, 8), ...repeat(CLOSED, 2), null, ...repeat(CLOSED, 2), ...repeat(OPEN, 8)]));
    expect(d.blinkCount).toBe(0);
  });

  it('discards a closure that coincides with large head motion', () => {
    const d = new BlinkDetector();
    const open = stream(repeat(OPEN, 8));
    const closing = stream(repeat(CLOSED, 4), 8 * FRAME_MS, 0.2); // big motion while "closed"
    const reopen = stream(repeat(OPEN, 8), 12 * FRAME_MS);
    run(d, [...open, ...closing, ...reopen]);
    expect(d.blinkCount).toBe(0);
  });

  it('reset() clears the count and the phase', () => {
    const d = new BlinkDetector();
    run(d, stream([...repeat(OPEN, 8), ...repeat(CLOSED, 4), ...repeat(OPEN, 8)]));
    expect(d.blinkCount).toBe(1);
    d.reset();
    expect(d.blinkCount).toBe(0);
    expect(d.currentPhase).toBe('unknown');
  });

  it('reports openness between 0 and 1', () => {
    const d = new BlinkDetector();
    const updates = run(d, stream([...repeat(OPEN, 5), ...repeat(CLOSED, 5)]));
    for (const u of updates) {
      expect(u.openness).toBeGreaterThanOrEqual(0);
      expect(u.openness).toBeLessThanOrEqual(1);
    }
    expect(updates[4].openness).toBeGreaterThan(updates[9].openness);
  });

  it('rejects invalid configuration', () => {
    expect(() => new BlinkDetector({ closeThreshold: 0.3, openThreshold: 0.2 })).toThrow(RangeError);
    expect(() => new BlinkDetector({ smoothingAlpha: 0 })).toThrow(RangeError);
  });
});
