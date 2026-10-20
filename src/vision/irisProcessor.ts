import type { Box, EyeGeometry, IrisStatus, QualityMetrics } from '../types/scanner';
import { computeQualityMetrics, type PixelImage } from './imageQuality';

/** One eye cropped out of one video frame. Lives in memory only. */
export interface EyeCapture {
  side: 'left' | 'right';
  image: ImageData;
  metrics: QualityMetrics;
  geometry: EyeGeometry;
  /** Eye geometry translated into crop-local pixel coordinates (for drawing the iris boundary). */
  local: { irisCenter: { x: number; y: number }; irisRadiusPx: number };
  irisStatus: IrisStatus;
}

export const CROP_PADDING = 0.35;

/** Expands the eye box by `padding` of its size on every side and clamps it to the frame. */
export function paddedCropBox(box: Box, frameW: number, frameH: number, padding = CROP_PADDING): Box {
  const padX = box.w * padding;
  const padY = Math.max(box.h * padding, box.w * 0.2); // keep some vertical context when the eye is nearly closed
  const x = Math.max(0, Math.floor(box.x - padX));
  const y = Math.max(0, Math.floor(box.y - padY));
  const right = Math.min(frameW, Math.ceil(box.x + box.w + padX));
  const bottom = Math.min(frameH, Math.ceil(box.y + box.h + padY));
  return { x, y, w: Math.max(0, right - x), h: Math.max(0, bottom - y) };
}

/**
 * The iris is only reported as "estimated" when the landmark model produced iris points and the
 * result is geometrically plausible. A plausible circle is NOT a verified segmentation.
 */
export function judgeIrisLocalization(eye: EyeGeometry): IrisStatus {
  if (eye.irisPoints.length === 0 || eye.irisRadiusPx <= 0 || eye.box.w <= 0) return 'not-localized';
  const ratio = (eye.irisRadiusPx * 2) / eye.box.w; // visible iris diameter / eye width, typically ~0.3-0.55
  const c = eye.irisCenter;
  const inside = c.x >= eye.box.x && c.x <= eye.box.x + eye.box.w && c.y >= eye.box.y && c.y <= eye.box.y + eye.box.h;
  if (!inside || ratio < 0.15 || ratio > 0.75 || eye.irisRadiusPx < 3) return 'not-localized';
  return 'estimated';
}

/** Crops one eye from the current video frame. Returns null when the crop would be empty. */
export function captureEye(
  video: HTMLVideoElement,
  eye: EyeGeometry,
  scratch: HTMLCanvasElement,
): EyeCapture | null {
  const w = video.videoWidth;
  const h = video.videoHeight;
  const crop = paddedCropBox(eye.box, w, h);
  if (crop.w < 4 || crop.h < 4) return null;

  scratch.width = crop.w;
  scratch.height = crop.h;
  const ctx = scratch.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
  const image = ctx.getImageData(0, 0, crop.w, crop.h);

  return {
    side: eye.side,
    image,
    metrics: computeQualityMetrics(image),
    geometry: eye,
    local: {
      irisCenter: { x: eye.irisCenter.x - crop.x, y: eye.irisCenter.y - crop.y },
      irisRadiusPx: eye.irisRadiusPx,
    },
    irisStatus: judgeIrisLocalization(eye),
  };
}

function imageToCanvas(image: PixelImage, canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
  return ctx;
}

/** Plain eye crop as a data URL (memory only). */
export function cropToDataUrl(capture: EyeCapture, canvas: HTMLCanvasElement): string | null {
  if (!imageToCanvas(capture.image, canvas)) return null;
  return canvas.toDataURL('image/png');
}

/** Eye crop with the estimated iris boundary drawn on top. */
export function boundaryToDataUrl(capture: EyeCapture, canvas: HTMLCanvasElement): string | null {
  const ctx = imageToCanvas(capture.image, canvas);
  if (!ctx) return null;
  const { irisCenter, irisRadiusPx } = capture.local;
  ctx.lineWidth = Math.max(1.5, capture.image.width / 120);
  ctx.strokeStyle = '#22d3ee';
  ctx.beginPath();
  ctx.arc(irisCenter.x, irisCenter.y, irisRadiusPx, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#2dd4bf';
  ctx.beginPath();
  ctx.arc(irisCenter.x, irisCenter.y, Math.max(1.5, irisRadiusPx * 0.08), 0, Math.PI * 2);
  ctx.fill();
  return canvas.toDataURL('image/png');
}

/**
 * EXPERIMENTAL, educational visualisation only.
 *
 * Unwraps the annulus between 35% and 100% of the estimated iris radius into a rectangular
 * strip (angle on x, radius on y) using bilinear sampling of the luma channel. This is the same
 * *idea* as the "rubber-sheet" normalisation used in published iris-recognition pipelines, but:
 *   - the circle comes from landmark estimates, not a validated iris/pupil segmentation,
 *   - the pupil boundary is a fixed fraction, and eyelids/eyelashes/reflections are not masked,
 *   - no feature extraction, template or matching is performed.
 * The output must not be treated as a biometric template.
 */
export function unwrapIris(
  img: PixelImage,
  cx: number,
  cy: number,
  radius: number,
  outWidth = 256,
  outHeight = 32,
  innerFraction = 0.35,
): PixelImage {
  const out = new Uint8ClampedArray(outWidth * outHeight * 4);
  const sample = (x: number, y: number): number => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const at = (xx: number, yy: number): number => {
      const cxp = Math.min(img.width - 1, Math.max(0, xx));
      const cyp = Math.min(img.height - 1, Math.max(0, yy));
      const i = (cyp * img.width + cxp) * 4;
      return 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
    };
    return (
      at(x0, y0) * (1 - fx) * (1 - fy) +
      at(x0 + 1, y0) * fx * (1 - fy) +
      at(x0, y0 + 1) * (1 - fx) * fy +
      at(x0 + 1, y0 + 1) * fx * fy
    );
  };

  for (let row = 0; row < outHeight; row++) {
    const rFrac = innerFraction + (1 - innerFraction) * (outHeight === 1 ? 0 : row / (outHeight - 1));
    const r = radius * rFrac;
    for (let col = 0; col < outWidth; col++) {
      const theta = (col / outWidth) * Math.PI * 2;
      const v = sample(cx + r * Math.cos(theta), cy + r * Math.sin(theta));
      const o = (row * outWidth + col) * 4;
      out[o] = v;
      out[o + 1] = v;
      out[o + 2] = v;
      out[o + 3] = 255;
    }
  }
  return { data: out, width: outWidth, height: outHeight };
}

export function unwrappedToDataUrl(strip: PixelImage, canvas: HTMLCanvasElement): string | null {
  if (!imageToCanvas(strip, canvas)) return null;
  return canvas.toDataURL('image/png');
}

/** Releases canvas backing stores (setting size to 0 frees the pixel buffer in most browsers). */
export function releaseCanvas(canvas: HTMLCanvasElement | null): void {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}
