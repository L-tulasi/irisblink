import type { EyeGeometry, FrameAssessment, FrameLandmarks, Point } from '../types/scanner';

/** Minimal landmark shape (MediaPipe NormalizedLandmark is structurally compatible). */
export interface NormalizedPoint {
  x: number;
  y: number;
  z?: number;
}

/**
 * MediaPipe Face Landmarker topology (478 landmarks: 468 face-mesh points + 10 refined iris points).
 * Indices follow the canonical face-mesh numbering. "right"/"left" are the SUBJECT's own eyes, so the
 * subject's right eye appears on the left of a non-mirrored image.
 *
 *   six EAR points, in order p1..p6 = [outer/first corner, upper, upper, opposite corner, lower, lower]
 */
export const EYE_LANDMARKS = {
  right: {
    ear: [33, 160, 158, 133, 153, 144],
    contour: [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246],
    irisCenter: 468,
    irisRing: [469, 470, 471, 472],
  },
  left: {
    ear: [362, 385, 387, 263, 373, 380],
    contour: [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398],
    irisCenter: 473,
    irisRing: [474, 475, 476, 477],
  },
} as const;

export const MIN_LANDMARKS_WITH_IRIS = 478;

export interface AssessConfig {
  /** Minimum eye width in pixels for the eye to count as "large enough". */
  minEyeWidthPx: number;
  /** Max |iris centre - eye centre| / eye width before we ask the user to look at the camera. */
  maxGazeOffset: number;
  /** Max per-frame normalised face-centre motion before we ask the user to hold still. */
  maxMotion: number;
}

export const DEFAULT_ASSESS_CONFIG: Readonly<AssessConfig> = {
  minEyeWidthPx: 44,
  maxGazeOffset: 0.22,
  maxMotion: 0.025,
};

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function toPx(lm: NormalizedPoint, width: number, height: number): Point {
  return { x: lm.x * width, y: lm.y * height };
}

/** Eye aspect ratio from six pixel-space points p1..p6. Returns 0 for a degenerate eye. */
export function eyeAspectRatio(p: readonly Point[]): number {
  if (p.length !== 6) throw new RangeError('eyeAspectRatio needs exactly 6 points');
  const horizontal = dist(p[0], p[3]);
  if (horizontal < 1e-6) return 0;
  return (dist(p[1], p[5]) + dist(p[2], p[4])) / (2 * horizontal);
}

function boundingBox(points: readonly Point[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const pt of points) {
    minX = Math.min(minX, pt.x);
    minY = Math.min(minY, pt.y);
    maxX = Math.max(maxX, pt.x);
    maxY = Math.max(maxY, pt.y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function buildEye(
  side: 'left' | 'right',
  face: readonly NormalizedPoint[],
  width: number,
  height: number,
): EyeGeometry | undefined {
  const def = EYE_LANDMARKS[side];
  const get = (i: number): Point | undefined => (face[i] ? toPx(face[i], width, height) : undefined);

  const earPts = def.ear.map(get);
  const contour = def.contour.map(get);
  if (earPts.some((p) => !p) || contour.some((p) => !p)) return undefined;
  const earPoints = earPts as Point[];
  const contourPts = contour as Point[];

  const center = get(def.irisCenter);
  const ring = def.irisRing.map(get);
  const hasIris = center !== undefined && ring.every((p) => p !== undefined);
  const box = boundingBox(contourPts);

  let irisCenter: Point;
  let irisPoints: Point[];
  let irisRadiusPx: number;
  if (hasIris) {
    irisCenter = center;
    irisPoints = ring as Point[];
    irisRadiusPx = irisPoints.reduce((s, p) => s + dist(p, irisCenter), 0) / irisPoints.length;
  } else {
    // No refined iris landmarks: fall back to the eye centre and a nominal radius. Callers must
    // treat this as "iris not localised" (see FrameLandmarks.hasIrisLandmarks).
    irisCenter = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
    irisPoints = [];
    irisRadiusPx = 0;
  }

  return {
    side,
    contour: contourPts,
    irisCenter,
    irisRadiusPx,
    irisPoints,
    ear: eyeAspectRatio(earPoints),
    box,
  };
}

/**
 * Converts the Face Landmarker output for one video frame into pixel-space eye geometry.
 * Only the first (primary) face is analysed; `faceCount` reports how many faces were seen so the
 * caller can refuse to scan when more than one person is in frame.
 */
export function extractEyes(
  faces: readonly (readonly NormalizedPoint[])[],
  width: number,
  height: number,
): FrameLandmarks {
  const faceCount = faces.length;
  if (faceCount === 0) return { faceCount, width, height, hasIrisLandmarks: false };

  const face = faces[0];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const lm of face) {
    minX = Math.min(minX, lm.x);
    minY = Math.min(minY, lm.y);
    maxX = Math.max(maxX, lm.x);
    maxY = Math.max(maxY, lm.y);
  }

  return {
    faceCount,
    width,
    height,
    left: buildEye('left', face, width, height),
    right: buildEye('right', face, width, height),
    faceCenter: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
    hasIrisLandmarks: face.length >= MIN_LANDMARKS_WITH_IRIS,
  };
}

/** Mean EAR of the eyes that were measured, or null when neither eye is available. */
export function meanEar(fl: FrameLandmarks): number | null {
  const values = [fl.left?.ear, fl.right?.ear].filter((v): v is number => typeof v === 'number');
  if (fl.faceCount !== 1 || values.length < 2) return null; // require both eyes: one-eye EAR is easily fooled by occlusion
  return (values[0] + values[1]) / 2;
}

/** Normalised distance between two face centres (0 when either is missing). */
export function faceMotion(prev: Point | undefined, current: Point | undefined): number {
  if (!prev || !current) return 0;
  return dist(prev, current);
}

function gazeOffset(eye: EyeGeometry): number {
  if (eye.box.w <= 0) return 1;
  const cx = eye.box.x + eye.box.w / 2;
  return Math.abs(eye.irisCenter.x - cx) / eye.box.w;
}

/**
 * Turns raw frame data into user guidance. `usable` is the gate for starting blink detection and
 * for accepting capture frames.
 */
export function assessFrame(
  fl: FrameLandmarks,
  motion: number,
  config: AssessConfig = DEFAULT_ASSESS_CONFIG,
): FrameAssessment {
  if (fl.faceCount === 0) {
    return { faceStatus: 'none', eyeStatus: 'none', usable: false, guidance: 'Center your face in the circle.' };
  }
  if (fl.faceCount > 1) {
    return {
      faceStatus: 'multiple',
      eyeStatus: 'none',
      usable: false,
      guidance: 'More than one face is visible. Scan one person at a time.',
    };
  }
  if (!fl.left || !fl.right || !fl.hasIrisLandmarks) {
    return { faceStatus: 'detected', eyeStatus: 'none', usable: false, guidance: 'Center your face. Both eyes need to be visible.' };
  }
  if (Math.min(fl.left.box.w, fl.right.box.w) < config.minEyeWidthPx) {
    return { faceStatus: 'detected', eyeStatus: 'too-small', usable: false, guidance: 'Move closer: the eye details are too small.' };
  }
  if (Math.max(gazeOffset(fl.left), gazeOffset(fl.right)) > config.maxGazeOffset) {
    return { faceStatus: 'detected', eyeStatus: 'off-axis', usable: false, guidance: 'Look toward the camera.' };
  }
  if (motion > config.maxMotion) {
    return { faceStatus: 'detected', eyeStatus: 'ok', usable: false, guidance: 'Hold still.' };
  }
  return { faceStatus: 'detected', eyeStatus: 'ok', usable: true, guidance: 'Good. Blink naturally.' };
}
