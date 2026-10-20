import type { QualityMetrics, QualityReason, QualityVerdict, ScanErrorCode } from '../types/scanner';

/** Minimal structural type so the functions work with ImageData and with plain test objects. */
export interface PixelImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface QualityThresholds {
  minWidth: number;
  minHeight: number;
  minBrightness: number;
  maxBrightness: number;
  maxOverexposedFraction: number;
  maxUnderexposedFraction: number;
  /** Minimum Laplacian variance. Resolution dependent; tune per camera. */
  minSharpness: number;
}

/**
 * Starting-point thresholds for an eye crop of roughly 60-300 px wide from a webcam or phone camera.
 * They are heuristics, not standards: tune them against your own cameras.
 */
export const DEFAULT_QUALITY_THRESHOLDS: Readonly<QualityThresholds> = {
  minWidth: 64,
  minHeight: 32,
  minBrightness: 45,
  maxBrightness: 215,
  maxOverexposedFraction: 0.2,
  maxUnderexposedFraction: 0.5,
  minSharpness: 30,
};

/** Rec. 601 luma for one RGBA pixel starting at index i. */
function luma(data: Uint8ClampedArray, i: number): number {
  return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
}

/**
 * Computes brightness, exposure fractions and a sharpness estimate.
 *
 * Sharpness = variance of the 3x3 Laplacian (kernel 0 1 0 / 1 -4 1 / 0 1 0) applied to the luma
 * image. Blurry images have few strong edges, so the variance is low. The absolute value depends on
 * image size and noise, so compare crops of similar size.
 */
export function computeQualityMetrics(img: PixelImage): QualityMetrics {
  const { data, width, height } = img;
  const n = width * height;
  if (n === 0 || data.length < n * 4) {
    return { width, height, brightness: 0, sharpness: 0, overexposedFraction: 0, underexposedFraction: 0 };
  }

  const gray = new Float32Array(n);
  let sum = 0;
  let over = 0;
  let under = 0;
  for (let p = 0; p < n; p++) {
    const y = luma(data, p * 4);
    gray[p] = y;
    sum += y;
    if (y >= 245) over++;
    if (y <= 20) under++;
  }

  let sharpness = 0;
  if (width >= 3 && height >= 3) {
    let lapSum = 0;
    let lapSq = 0;
    let count = 0;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x;
        const lap = gray[i - width] + gray[i + width] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
        lapSum += lap;
        lapSq += lap * lap;
        count++;
      }
    }
    const mean = lapSum / count;
    sharpness = lapSq / count - mean * mean;
  }

  return {
    width,
    height,
    brightness: sum / n,
    sharpness,
    overexposedFraction: over / n,
    underexposedFraction: under / n,
  };
}

/** Applies thresholds and returns every reason a crop is unsuitable (empty reasons => ok). */
export function evaluateQuality(
  metrics: QualityMetrics,
  thresholds: QualityThresholds = DEFAULT_QUALITY_THRESHOLDS,
): QualityVerdict {
  const reasons: QualityReason[] = [];
  if (metrics.width < thresholds.minWidth || metrics.height < thresholds.minHeight) reasons.push('too-small');
  if (metrics.brightness < thresholds.minBrightness || metrics.underexposedFraction > thresholds.maxUnderexposedFraction) {
    reasons.push('too-dark');
  }
  if (metrics.brightness > thresholds.maxBrightness || metrics.overexposedFraction > thresholds.maxOverexposedFraction) {
    reasons.push('overexposed');
  }
  if (metrics.sharpness < thresholds.minSharpness) reasons.push('blurry');
  return { ok: reasons.length === 0, reasons };
}

/**
 * Chooses the most useful failure code when NO captured eye crop passed the quality checks.
 * Takes the reasons of every rejected crop and returns the most common category
 * (lighting beats blur beats size on ties, because lighting is the easiest thing for a user to fix).
 */
export function failureCodeForReasons(reasonLists: readonly (readonly QualityReason[])[]): ScanErrorCode {
  const counts = { lighting: 0, blurry: 0, small: 0 };
  for (const reasons of reasonLists) {
    if (reasons.includes('too-dark') || reasons.includes('overexposed')) counts.lighting++;
    if (reasons.includes('blurry')) counts.blurry++;
    if (reasons.includes('too-small')) counts.small++;
  }
  if (counts.lighting === 0 && counts.blurry === 0 && counts.small === 0) return 'unknown';
  if (counts.lighting >= counts.blurry && counts.lighting >= counts.small) return 'poor-lighting';
  if (counts.blurry >= counts.small) return 'blurry';
  return 'eyes-not-visible';
}

export const QUALITY_REASON_TEXT: Record<QualityReason, string> = {
  'too-small': 'The eye region is too small (move closer or use a higher-resolution camera).',
  'too-dark': 'The eye region is too dark.',
  overexposed: 'The eye region is overexposed (glare or too much light).',
  blurry: 'The eye region is too blurry.',
};
