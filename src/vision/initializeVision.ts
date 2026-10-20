import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { ScanError } from '../types/scanner';

/**
 * Loads the MediaPipe Face Landmarker (Tasks Vision API, `FaceLandmarker` + `FilesetResolver`).
 *
 * Defaults download the WASM runtime from jsDelivr and the model from Google's model storage the first
 * time a scan starts, so the app is NOT offline-capable out of the box. Use `npm run vendor:mediapipe`
 * and the VITE_* variables in `.env.example` to self-host both.
 */
const PINNED_VERSION = '0.10.21';

export const WASM_URL: string =
  import.meta.env.VITE_MEDIAPIPE_WASM_URL ||
  `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${PINNED_VERSION}/wasm`;

export const MODEL_URL: string =
  import.meta.env.VITE_FACE_MODEL_URL ||
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

let cached: Promise<FaceLandmarker> | null = null;
let resolved: FaceLandmarker | null = null;

async function create(): Promise<FaceLandmarker> {
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  const options = {
    runningMode: 'VIDEO' as const,
    numFaces: 2, // 2 so we can notice (and refuse) a second face in frame
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false,
  };
  try {
    return await FaceLandmarker.createFromOptions(vision, {
      ...options,
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
    });
  } catch {
    // GPU delegate is unavailable on some browsers/devices; the CPU delegate works everywhere.
    return await FaceLandmarker.createFromOptions(vision, {
      ...options,
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
    });
  }
}

/** Shared, lazily created landmarker. A failed load is not cached, so Retry really retries. */
export function getFaceLandmarker(): Promise<FaceLandmarker> {
  if (!cached) {
    cached = create()
      .then((lm) => {
        resolved = lm;
        return lm;
      })
      .catch((err: unknown) => {
        cached = null;
        throw new ScanError('model-failed', err instanceof Error ? err.message : String(err));
      });
  }
  return cached;
}

/** Releases the WASM resources. Safe to call repeatedly. */
export function closeFaceLandmarker(): void {
  resolved?.close();
  resolved = null;
  cached = null;
}
