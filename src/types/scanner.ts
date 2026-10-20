/** Shared types and small runtime helpers for the scanner. */

export type ScanState =
  | 'idle'
  | 'requesting-camera'
  | 'initializing-model'
  | 'detecting-face'
  | 'detecting-eyes'
  | 'waiting-for-blink'
  | 'blink-detected'
  | 'capturing-frames'
  | 'analyzing-quality'
  | 'completed'
  | 'failed'
  | 'stopped';

export type ScanErrorCode =
  | 'permission-denied'
  | 'no-camera'
  | 'camera-in-use'
  | 'unsupported-browser'
  | 'model-failed'
  | 'no-face'
  | 'eyes-not-visible'
  | 'no-blink'
  | 'poor-lighting'
  | 'blurry'
  | 'camera-interrupted'
  | 'aborted'
  | 'unknown';

export interface ErrorCopy {
  title: string;
  advice: string;
}

/** Friendly, actionable text for every error code. */
export const ERROR_COPY: Record<ScanErrorCode, ErrorCopy> = {
  'permission-denied': {
    title: 'Camera permission was denied',
    advice:
      'Allow camera access for this site in your browser or system settings, then press Retry. On iPhone: Settings > Safari > Camera. On macOS: System Settings > Privacy & Security > Camera.',
  },
  'no-camera': {
    title: 'No camera was found',
    advice: 'Connect or enable a camera, make sure no privacy shutter covers it, then press Retry.',
  },
  'camera-in-use': {
    title: 'The camera is already in use',
    advice: 'Close other apps or browser tabs that use the camera (video calls, other scanners), then press Retry.',
  },
  'unsupported-browser': {
    title: 'This browser cannot run the scanner',
    advice:
      'Camera access needs a modern browser and a secure (HTTPS or localhost) page. Try the latest Chrome, Edge, Firefox or Safari, and open the app over HTTPS.',
  },
  'model-failed': {
    title: 'The face-landmark model could not be loaded',
    advice:
      'The model and WASM runtime are downloaded the first time you scan. Check your internet connection, disable blockers that stop cdn.jsdelivr.net or storage.googleapis.com, or self-host the files (see README), then Retry.',
  },
  'no-face': {
    title: 'No face was detected',
    advice: 'Center your face in the frame, add light in front of you, and remove anything covering your face.',
  },
  'eyes-not-visible': {
    title: 'Your eyes were not clearly visible',
    advice: 'Move closer, look toward the camera, lift hair or glasses glare out of the way, and keep your eyes open between blinks.',
  },
  'no-blink': {
    title: 'No blink was detected in time',
    advice: 'Blink naturally once while looking at the camera. Bright, even light in front of you helps. Heavy glare on glasses can hide blinks.',
  },
  'poor-lighting': {
    title: 'Lighting was too poor for a usable eye image',
    advice: 'Face a window or lamp so your face is evenly lit. Avoid strong backlight and avoid direct glare on the eyes.',
  },
  blurry: {
    title: 'The eye image was too blurry',
    advice: 'Hold the device steady, hold still for a moment, clean the camera lens, and make sure there is enough light.',
  },
  'camera-interrupted': {
    title: 'The camera was interrupted',
    advice: 'The camera stopped during the scan (disconnected, taken by another app, or the page was hidden). Press Retry to start again.',
  },
  aborted: {
    title: 'The scan was cancelled',
    advice: 'Start a new scan whenever you are ready.',
  },
  unknown: {
    title: 'Something went wrong',
    advice: 'Press Retry. If it keeps happening, reload the page and check the browser console for details.',
  },
};

export class ScanError extends Error {
  readonly code: ScanErrorCode;
  constructor(code: ScanErrorCode, detail?: string) {
    super(detail ?? ERROR_COPY[code].title);
    this.name = 'ScanError';
    this.code = code;
  }
}

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Eye geometry in video pixel coordinates. */
export interface EyeGeometry {
  /** "right" / "left" refer to the subject's own right/left eye. */
  side: 'left' | 'right';
  contour: Point[];
  irisCenter: Point;
  /** Mean distance from iris centre to the four iris-boundary landmarks, in pixels. */
  irisRadiusPx: number;
  irisPoints: Point[];
  /** Eye aspect ratio (open eye is roughly 0.25-0.35). */
  ear: number;
  box: Box;
}

export interface FrameLandmarks {
  faceCount: number;
  width: number;
  height: number;
  left?: EyeGeometry;
  right?: EyeGeometry;
  /** Face bounding-box centre in normalised [0,1] coordinates. */
  faceCenter?: Point;
  /** Whether iris landmarks (indices 468-477) were present in the model output. */
  hasIrisLandmarks: boolean;
}

export type FaceStatus = 'none' | 'multiple' | 'detected';
export type EyeStatus = 'none' | 'too-small' | 'off-axis' | 'ok';

export interface FrameAssessment {
  faceStatus: FaceStatus;
  eyeStatus: EyeStatus;
  /** True when both eyes are present, large enough and roughly facing the camera. */
  usable: boolean;
  guidance: string;
}

export interface QualityMetrics {
  width: number;
  height: number;
  /** Mean luminance 0-255. */
  brightness: number;
  /** Variance of the 3x3 Laplacian of the luminance image (higher = sharper). */
  sharpness: number;
  /** Fraction of pixels with luminance >= 245. */
  overexposedFraction: number;
  /** Fraction of pixels with luminance <= 20. */
  underexposedFraction: number;
}

export type QualityReason = 'too-small' | 'too-dark' | 'overexposed' | 'blurry';

export interface QualityVerdict {
  ok: boolean;
  reasons: QualityReason[];
}

export type IrisStatus = 'estimated' | 'not-localized';

export interface ScanResult {
  success: boolean;
  failureCode: ScanErrorCode | null;
  eyeDetected: boolean;
  blinkObserved: boolean;
  blinkCount: number;
  blinkConfidence: number;
  framesCaptured: number;
  framesAccepted: number;
  eyeSide: 'left' | 'right' | null;
  metrics: QualityMetrics | null;
  verdict: QualityVerdict | null;
  irisStatus: IrisStatus;
  irisRadiusPx: number | null;
  /** In-memory data URLs. Only set when the crop passed every quality check. */
  cropUrl: string | null;
  boundaryUrl: string | null;
  unwrappedUrl: string | null;
}
