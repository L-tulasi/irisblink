import { describe, expect, it } from 'vitest';
import {
  computeQualityMetrics,
  DEFAULT_QUALITY_THRESHOLDS,
  evaluateQuality,
  failureCodeForReasons,
  type PixelImage,
} from '../vision/imageQuality';
import { unwrapIris } from '../vision/irisProcessor';
import type { QualityMetrics } from '../types/scanner';

function solid(width: number, height: number, value: number): PixelImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = value;
    data[i * 4 + 1] = value;
    data[i * 4 + 2] = value;
    data[i * 4 + 3] = 255;
  }
  return { data, width, height };
}

/** High-contrast checkerboard (very sharp). */
function checker(width: number, height: number, lo = 60, hi = 200): PixelImage {
  const img = solid(width, height, 0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = (x + y) % 2 === 0 ? lo : hi;
      const i = (y * width + x) * 4;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
    }
  }
  return img;
}

const good: QualityMetrics = {
  width: 160,
  height: 80,
  brightness: 120,
  sharpness: 150,
  overexposedFraction: 0.01,
  underexposedFraction: 0.01,
};

describe('computeQualityMetrics', () => {
  it('reports brightness of a solid image and zero sharpness', () => {
    const m = computeQualityMetrics(solid(40, 20, 100));
    expect(m.width).toBe(40);
    expect(m.height).toBe(20);
    expect(m.brightness).toBeCloseTo(100, 0);
    expect(m.sharpness).toBe(0);
  });

  it('gives a sharp checkerboard far higher sharpness than a flat image', () => {
    expect(computeQualityMetrics(checker(40, 40)).sharpness).toBeGreaterThan(1000);
  });

  it('measures over- and under-exposed pixel fractions', () => {
    expect(computeQualityMetrics(solid(10, 10, 255)).overexposedFraction).toBe(1);
    expect(computeQualityMetrics(solid(10, 10, 0)).underexposedFraction).toBe(1);
  });

  it('handles empty images without throwing', () => {
    const m = computeQualityMetrics({ data: new Uint8ClampedArray(0), width: 0, height: 0 });
    expect(m.brightness).toBe(0);
    expect(m.sharpness).toBe(0);
  });
});

describe('evaluateQuality thresholds', () => {
  it('accepts a good crop', () => {
    expect(evaluateQuality(good)).toEqual({ ok: true, reasons: [] });
  });

  it('rejects crops that are too small', () => {
    const v = evaluateQuality({ ...good, width: DEFAULT_QUALITY_THRESHOLDS.minWidth - 1 });
    expect(v.ok).toBe(false);
    expect(v.reasons).toContain('too-small');
  });

  it('rejects dark crops', () => {
    expect(evaluateQuality({ ...good, brightness: 20 }).reasons).toContain('too-dark');
    expect(evaluateQuality({ ...good, underexposedFraction: 0.9 }).reasons).toContain('too-dark');
  });

  it('rejects overexposed crops', () => {
    expect(evaluateQuality({ ...good, brightness: 240 }).reasons).toContain('overexposed');
    expect(evaluateQuality({ ...good, overexposedFraction: 0.5 }).reasons).toContain('overexposed');
  });

  it('rejects blurry crops', () => {
    expect(evaluateQuality({ ...good, sharpness: 2 }).reasons).toContain('blurry');
  });

  it('treats values exactly at the threshold as acceptable', () => {
    const t = DEFAULT_QUALITY_THRESHOLDS;
    const edge = { ...good, width: t.minWidth, height: t.minHeight, brightness: t.minBrightness, sharpness: t.minSharpness };
    expect(evaluateQuality(edge).ok).toBe(true);
  });

  it('lists every reason that applies', () => {
    const v = evaluateQuality({ ...good, width: 10, brightness: 10, sharpness: 0 });
    expect(v.reasons).toContain('too-small');
    expect(v.reasons).toContain('too-dark');
    expect(v.reasons).toContain('blurry');
  });

  it('honours custom thresholds', () => {
    const strict = { ...DEFAULT_QUALITY_THRESHOLDS, minSharpness: 500 };
    expect(evaluateQuality(good, strict).reasons).toContain('blurry');
  });
});

describe('failureCodeForReasons', () => {
  it('prefers lighting when it is the most common problem', () => {
    expect(failureCodeForReasons([['too-dark'], ['too-dark', 'blurry'], ['blurry']])).toBe('poor-lighting');
  });
  it('reports blur when blur dominates', () => {
    expect(failureCodeForReasons([['blurry'], ['blurry'], ['too-dark']])).toBe('blurry');
  });
  it('reports eyes-not-visible when size dominates', () => {
    expect(failureCodeForReasons([['too-small'], ['too-small'], ['blurry']])).toBe('eyes-not-visible');
  });
  it('returns unknown for no reasons', () => {
    expect(failureCodeForReasons([])).toBe('unknown');
  });
});

describe('unwrapIris (experimental visualisation)', () => {
  it('returns a strip of the requested size and samples a radially symmetric image uniformly', () => {
    const size = 64;
    const img = solid(size, size, 90);
    const strip = unwrapIris(img, 32, 32, 20, 64, 8);
    expect(strip.width).toBe(64);
    expect(strip.height).toBe(8);
    expect(strip.data.length).toBe(64 * 8 * 4);
    expect(strip.data[0]).toBe(90);
    expect(strip.data[3]).toBe(255);
  });
});
