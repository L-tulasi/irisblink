import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { FaceLandmarker } from '@mediapipe/tasks-vision';
import { closeFaceLandmarker, getFaceLandmarker } from '../vision/initializeVision';
import { BlinkDetector, DEFAULT_BLINK_CONFIG } from '../vision/blinkDetector';
import { assessFrame, extractEyes, faceMotion, meanEar } from '../vision/faceLandmarks';
import {
  boundaryToDataUrl,
  captureEye,
  cropToDataUrl,
  releaseCanvas,
  unwrapIris,
  unwrappedToDataUrl,
  type EyeCapture,
} from '../vision/irisProcessor';
import { evaluateQuality, failureCodeForReasons } from '../vision/imageQuality';
import { canStartScan, canTransition, isActiveState, STATE_MESSAGES } from '../vision/scanMachine';
import {
  ScanError,
  type FrameAssessment,
  type FrameLandmarks,
  type Point,
  type QualityReason,
  type ScanErrorCode,
  type ScanResult,
  type ScanState,
} from '../types/scanner';
import { useCamera, type UseCamera } from './useCamera';

// --- Tunable scan parameters (documented in README) -------------------------------------------
const BLINK_TIMEOUT_MS = 15_000; // give up waiting for a blink after this long
const STABLE_FRAMES_REQUIRED = 8; // consecutive usable frames before blink detection is armed
const FACE_LOST_GRACE_MS = 1_500; // face may vanish this long before we restart detection
const SNAPSHOT_INTERVAL_MS = 150; // pre-blink "eye open" snapshots
const MAX_PRE_FRAMES = 2;
const POST_FRAMES_TARGET = 4; // frames captured after the blink
const POST_FRAME_INTERVAL_MS = 120;
const POST_BLINK_SETTLE_MS = 250; // let the eyelids fully reopen before capturing
const CAPTURE_TIMEOUT_MS = 3_000;
const UI_UPDATE_INTERVAL_MS = 66; // throttle React updates to ~15 Hz

interface Candidate {
  eyes: EyeCapture[];
}

interface Engine {
  scanId: number;
  running: boolean;
  paused: boolean;
  rafId: number;
  landmarker: FaceLandmarker | null;
  detector: BlinkDetector;
  lastVideoTime: number;
  lastTimestamp: number;
  prevFaceCenter: Point | undefined;
  stableFrames: number;
  waitStartMs: number;
  faceLostSince: number | null;
  lastSnapshotMs: number;
  preFrames: Candidate[];
  postFrames: Candidate[];
  blinkAtMs: number;
  captureStartMs: number;
  lastCaptureMs: number;
  blinkConfidence: number;
  lastUiMs: number;
  lastOpenness: number;
  scratch: HTMLCanvasElement | null;
}

function createEngine(): Engine {
  return {
    scanId: 0,
    running: false,
    paused: false,
    rafId: 0,
    landmarker: null,
    detector: new BlinkDetector(),
    lastVideoTime: -1,
    lastTimestamp: 0,
    prevFaceCenter: undefined,
    stableFrames: 0,
    waitStartMs: 0,
    faceLostSince: null,
    lastSnapshotMs: 0,
    preFrames: [],
    postFrames: [],
    blinkAtMs: 0,
    captureStartMs: 0,
    lastCaptureMs: 0,
    blinkConfidence: 0,
    lastUiMs: 0,
    lastOpenness: 0,
    scratch: null,
  };
}

function emptyResult(over: Partial<ScanResult> = {}): ScanResult {
  return {
    success: false,
    failureCode: null,
    eyeDetected: false,
    blinkObserved: false,
    blinkCount: 0,
    blinkConfidence: 0,
    framesCaptured: 0,
    framesAccepted: 0,
    eyeSide: null,
    metrics: null,
    verdict: null,
    irisStatus: 'not-localized',
    irisRadiusPx: null,
    cropUrl: null,
    boundaryUrl: null,
    unwrappedUrl: null,
    ...over,
  };
}

export interface FrameInfo {
  landmarks: FrameLandmarks;
  assessment: FrameAssessment;
}

export interface UseIrisScanner {
  state: ScanState;
  message: string;
  guidance: string;
  error: ScanError | null;
  notice: string | null;
  result: ScanResult | null;
  frame: FrameInfo | null;
  blinkCount: number;
  framesCaptured: number;
  /** 0-1 overall progress for the circular indicator. */
  progress: number;
  /** 0-1 live eye-openness estimate. */
  openness: number;
  blinkConfidence: number;
  videoRef: RefObject<HTMLVideoElement>;
  camera: UseCamera;
  canSwitchCamera: boolean;
  begin: () => Promise<void>;
  cancelScan: () => void;
  stopCamera: () => void;
  switchCamera: () => Promise<void>;
  goHome: () => void;
  clearData: () => void;
}

export function useIrisScanner(): UseIrisScanner {
  const [state, setStateValue] = useState<ScanState>('idle');
  const [message, setMessage] = useState(STATE_MESSAGES.idle);
  const [guidance, setGuidance] = useState('');
  const [error, setError] = useState<ScanError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [frame, setFrame] = useState<FrameInfo | null>(null);
  const [blinkCount, setBlinkCount] = useState(0);
  const [framesCaptured, setFramesCaptured] = useState(0);
  const [openness, setOpenness] = useState(0);
  const [blinkConfidence, setBlinkConfidence] = useState(0);

  const stateRef = useRef<ScanState>('idle');
  const engineRef = useRef<Engine>(createEngine());
  const videoRef = useRef<HTMLVideoElement>(null);
  const switchingRef = useRef(false);

  /** The only way state changes: refuses transitions the state machine does not allow. */
  const go = useCallback((to: ScanState): boolean => {
    const from = stateRef.current;
    if (!canTransition(from, to)) {
      if (import.meta.env.DEV) console.warn(`[IrisBlink] blocked invalid transition ${from} -> ${to}`);
      return false;
    }
    stateRef.current = to;
    setStateValue(to);
    setMessage(STATE_MESSAGES[to]);
    return true;
  }, []);

  const stopLoop = useCallback(() => {
    const e = engineRef.current;
    e.running = false;
    if (e.rafId) cancelAnimationFrame(e.rafId);
    e.rafId = 0;
  }, []);

  const releaseFrames = useCallback(() => {
    const e = engineRef.current;
    e.preFrames = [];
    e.postFrames = [];
    releaseCanvas(e.scratch);
    e.scratch = null;
  }, []);

  const interrupted = useCallback(() => {
    // Camera track ended (unplugged, taken by another app, OS revoked access).
    const e = engineRef.current;
    if (!isActiveState(stateRef.current)) return;
    e.scanId++;
    stopLoop();
    releaseFrames();
    setError(new ScanError('camera-interrupted'));
    setResult(emptyResult({ failureCode: 'camera-interrupted' }));
    go('failed');
  }, [go, stopLoop, releaseFrames]);

  const camera = useCamera(interrupted);
  const { start: startCamera, stop: stopCameraStream } = camera;

  const resetCounters = useCallback(() => {
    setBlinkCount(0);
    setFramesCaptured(0);
    setOpenness(0);
    setBlinkConfidence(0);
    setFrame(null);
    setGuidance('');
  }, []);

  const finishFailed = useCallback(
    (id: number, code: ScanErrorCode, partial: Partial<ScanResult> = {}) => {
      const e = engineRef.current;
      if (e.scanId !== id) return; // stale
      stopLoop();
      stopCameraStream();
      releaseFrames();
      setError(new ScanError(code));
      setResult(
        emptyResult({
          failureCode: code,
          blinkObserved: e.detector.blinkCount > 0,
          blinkCount: e.detector.blinkCount,
          blinkConfidence: e.blinkConfidence,
          ...partial,
        }),
      );
      go('failed');
    },
    [go, stopLoop, stopCameraStream, releaseFrames],
  );

  /** Picks the best crop, evaluates quality, and either completes or fails. Never reports false success. */
  const analyze = useCallback(
    (id: number) => {
      const e = engineRef.current;
      if (e.scanId !== id || stateRef.current !== 'analyzing-quality') return;

      const candidates = [...e.preFrames, ...e.postFrames];
      const base = {
        eyeDetected: candidates.length > 0,
        blinkObserved: e.detector.blinkCount > 0,
        blinkCount: e.detector.blinkCount,
        blinkConfidence: e.blinkConfidence,
        framesCaptured: candidates.length,
      };
      if (candidates.length === 0) {
        finishFailed(id, 'eyes-not-visible', base);
        return;
      }

      let framesAccepted = 0;
      let best: EyeCapture | null = null; // best crop that passed every check
      let bestRejected: EyeCapture | null = null;
      const rejectedReasons: QualityReason[][] = [];
      for (const cand of candidates) {
        let frameOk = false;
        for (const eye of cand.eyes) {
          const verdict = evaluateQuality(eye.metrics);
          if (verdict.ok) {
            frameOk = true;
            if (!best || eye.metrics.sharpness > best.metrics.sharpness) best = eye;
          } else {
            rejectedReasons.push(verdict.reasons);
            if (!bestRejected || eye.metrics.sharpness > bestRejected.metrics.sharpness) bestRejected = eye;
          }
        }
        if (frameOk) framesAccepted++;
      }

      if (!best) {
        const code = failureCodeForReasons(rejectedReasons);
        finishFailed(id, code === 'unknown' ? 'eyes-not-visible' : code, {
          ...base,
          framesAccepted,
          eyeSide: bestRejected?.side ?? null,
          metrics: bestRejected?.metrics ?? null,
          verdict: bestRejected ? evaluateQuality(bestRejected.metrics) : null,
          irisStatus: bestRejected?.irisStatus ?? 'not-localized',
        });
        return;
      }

      const canvas = document.createElement('canvas');
      const estimated = best.irisStatus === 'estimated';
      const cropUrl = cropToDataUrl(best, canvas);
      const boundaryUrl = estimated ? boundaryToDataUrl(best, canvas) : null;
      let unwrappedUrl: string | null = null;
      if (estimated) {
        const strip = unwrapIris(best.image, best.local.irisCenter.x, best.local.irisCenter.y, best.local.irisRadiusPx);
        unwrappedUrl = unwrappedToDataUrl(strip, canvas);
      }
      releaseCanvas(canvas);

      stopLoop();
      stopCameraStream(); // camera off as soon as the scan ends
      releaseFrames();
      setResult(
        emptyResult({
          ...base,
          success: true,
          framesAccepted,
          eyeSide: best.side,
          metrics: best.metrics,
          verdict: evaluateQuality(best.metrics),
          irisStatus: best.irisStatus,
          irisRadiusPx: estimated ? best.local.irisRadiusPx : null,
          cropUrl,
          boundaryUrl,
          unwrappedUrl,
        }),
      );
      setError(null);
      go('completed');
    },
    [finishFailed, go, stopLoop, stopCameraStream, releaseFrames],
  );

  const captureCandidate = useCallback((video: HTMLVideoElement, fl: FrameLandmarks): Candidate | null => {
    const e = engineRef.current;
    if (!e.scratch) e.scratch = document.createElement('canvas');
    const eyes: EyeCapture[] = [];
    for (const geometry of [fl.left, fl.right]) {
      if (!geometry) continue;
      const cap = captureEye(video, geometry, e.scratch);
      if (cap) eyes.push(cap);
    }
    return eyes.length > 0 ? { eyes } : null;
  }, []);

  const processFrame = useCallback(
    (id: number, video: HTMLVideoElement, now: number) => {
      const e = engineRef.current;
      const lm = e.landmarker;
      if (!lm) return;

      const ts = Math.max(now, e.lastTimestamp + 1); // MediaPipe needs strictly increasing timestamps
      e.lastTimestamp = ts;
      let faces: ReturnType<FaceLandmarker['detectForVideo']>['faceLandmarks'];
      try {
        faces = lm.detectForVideo(video, ts).faceLandmarks;
      } catch {
        finishFailed(id, 'unknown');
        return;
      }

      const fl = extractEyes(faces, video.videoWidth, video.videoHeight);
      const motion = faceMotion(e.prevFaceCenter, fl.faceCenter);
      e.prevFaceCenter = fl.faceCenter;
      const assess = assessFrame(fl, motion);
      const rawEar = meanEar(fl);
      const earOpen = rawEar !== null && rawEar >= DEFAULT_BLINK_CONFIG.openThreshold;
      const measurable = assess.eyeStatus !== 'none' && assess.eyeStatus !== 'too-small';
      let guide = assess.guidance;
      let openNow = e.lastOpenness;

      switch (stateRef.current) {
        case 'detecting-face':
          if (fl.faceCount === 1) {
            e.stableFrames = 0;
            go('detecting-eyes');
          }
          break;

        case 'detecting-eyes':
          if (fl.faceCount !== 1) {
            go('detecting-face');
          } else if (assess.usable && earOpen) {
            e.stableFrames++;
            if (e.stableFrames >= STABLE_FRAMES_REQUIRED) {
              e.detector.reset();
              e.waitStartMs = now;
              e.faceLostSince = null;
              e.preFrames = [];
              e.lastSnapshotMs = 0;
              go('waiting-for-blink');
            }
          } else {
            e.stableFrames = 0;
          }
          break;

        case 'waiting-for-blink': {
          if (now - e.waitStartMs > BLINK_TIMEOUT_MS) {
            finishFailed(id, 'no-blink', {
              eyeDetected: true,
              framesCaptured: e.preFrames.length,
            });
            return;
          }
          if (fl.faceCount !== 1) {
            e.faceLostSince ??= now;
            if (now - e.faceLostSince > FACE_LOST_GRACE_MS) {
              e.detector.reset();
              e.stableFrames = 0;
              e.faceLostSince = null;
              go('detecting-face');
              break;
            }
          } else {
            e.faceLostSince = null;
          }

          const upd = e.detector.update({ timestampMs: now, ear: measurable ? rawEar : null, motion });
          openNow = upd.openness;
          if (assess.usable) guide = 'Blink naturally.';

          if (upd.blink) {
            e.blinkAtMs = now;
            e.blinkConfidence = upd.blink.confidence;
            setBlinkCount(e.detector.blinkCount);
            setBlinkConfidence(upd.blink.confidence);
            go('blink-detected');
            guide = 'Blink detected. Keep your eyes open.';
          } else if (upd.phase === 'open' && assess.usable && earOpen && now - e.lastSnapshotMs >= SNAPSHOT_INTERVAL_MS) {
            // Rolling "eye clearly open before the blink" snapshots.
            e.lastSnapshotMs = now;
            const cand = captureCandidate(video, fl);
            if (cand) e.preFrames = [...e.preFrames, cand].slice(-MAX_PRE_FRAMES);
          }
          break;
        }

        case 'blink-detected':
          guide = 'Blink detected. Keep your eyes open.';
          if (now - e.blinkAtMs >= POST_BLINK_SETTLE_MS) {
            e.captureStartMs = now;
            e.lastCaptureMs = 0;
            e.postFrames = [];
            go('capturing-frames');
          }
          break;

        case 'capturing-frames': {
          guide = assess.usable ? 'Hold still. Capturing...' : assess.guidance;
          // Closed-eye frames are never captured: require a clearly open eye (EAR) and a usable frame.
          if (assess.usable && earOpen && now - e.lastCaptureMs >= POST_FRAME_INTERVAL_MS) {
            e.lastCaptureMs = now;
            const cand = captureCandidate(video, fl);
            if (cand) {
              e.postFrames.push(cand);
              setFramesCaptured(e.preFrames.length + e.postFrames.length);
            }
          }
          if (e.postFrames.length >= POST_FRAMES_TARGET || now - e.captureStartMs > CAPTURE_TIMEOUT_MS) {
            stopLoop();
            if (go('analyzing-quality')) {
              setFramesCaptured(e.preFrames.length + e.postFrames.length);
              window.setTimeout(() => analyze(id), 0);
            }
            return;
          }
          break;
        }

        default:
          break;
      }

      if (now - e.lastUiMs >= UI_UPDATE_INTERVAL_MS) {
        e.lastUiMs = now;
        setFrame({ landmarks: fl, assessment: assess });
        setGuidance(guide);
        e.lastOpenness = openNow;
        setOpenness(openNow);
      }
    },
    [analyze, captureCandidate, finishFailed, go, stopLoop],
  );

  const startLoop = useCallback(
    (id: number) => {
      const e = engineRef.current;
      const step = () => {
        if (!e.running || e.scanId !== id) return;
        const video = videoRef.current;
        if (
          !e.paused &&
          video &&
          video.readyState >= 2 &&
          video.videoWidth > 0 &&
          video.currentTime !== e.lastVideoTime // never process the same decoded frame twice
        ) {
          e.lastVideoTime = video.currentTime;
          processFrame(id, video, performance.now());
        }
        if (e.running && e.scanId === id) e.rafId = requestAnimationFrame(step);
      };
      e.running = true;
      e.rafId = requestAnimationFrame(step);
    },
    [processFrame],
  );

  const begin = useCallback(async () => {
    // Duplicate-start guard: only idle/terminal states may start a scan, and `go` flips the state synchronously.
    if (!canStartScan(stateRef.current)) return;
    const e = engineRef.current;
    const id = ++e.scanId;
    e.detector = new BlinkDetector();
    e.lastVideoTime = -1;
    e.lastTimestamp = 0;
    e.prevFaceCenter = undefined;
    e.stableFrames = 0;
    e.blinkConfidence = 0;
    e.paused = false;
    releaseFrames();
    resetCounters();
    setResult(null);
    setError(null);
    setNotice(null);
    if (!go('requesting-camera')) return;

    try {
      await startCamera();
    } catch (err) {
      if (e.scanId !== id) return;
      const code = err instanceof ScanError ? err.code : 'unknown';
      finishFailed(id, code);
      return;
    }
    if (e.scanId !== id) return; // cancelled while the permission prompt was open

    go('initializing-model');
    try {
      e.landmarker = await getFaceLandmarker();
    } catch {
      finishFailed(id, 'model-failed');
      return;
    }
    if (e.scanId !== id) return;

    if (go('detecting-face')) startLoop(id);
  }, [finishFailed, go, releaseFrames, resetCounters, startCamera, startLoop]);

  const endScan = useCallback(
    (to: 'stopped', note: string | null) => {
      const e = engineRef.current;
      e.scanId++; // invalidate every in-flight async step
      stopLoop();
      releaseFrames();
      stopCameraStream();
      setNotice(note);
      go(to);
    },
    [go, stopLoop, releaseFrames, stopCameraStream],
  );

  const stopCamera = useCallback(() => {
    if (isActiveState(stateRef.current) || stateRef.current === 'requesting-camera') {
      endScan('stopped', 'Camera stopped. Nothing was saved.');
    } else {
      stopCameraStream();
    }
  }, [endScan, stopCameraStream]);

  const clearData = useCallback(() => {
    releaseFrames();
    setResult(null);
    setFrame(null);
    resetCounters();
    setError(null);
  }, [releaseFrames, resetCounters]);

  const goHome = useCallback(() => {
    if (isActiveState(stateRef.current) || stateRef.current === 'requesting-camera') {
      endScan('stopped', null);
    }
    clearData();
    setNotice(null);
    if (stateRef.current !== 'idle') go('idle');
  }, [clearData, endScan, go]);

  const cancelScan = useCallback(() => {
    goHome();
  }, [goHome]);

  const switchCamera = useCallback(async () => {
    const cur = stateRef.current;
    if (switchingRef.current) return;
    if (cur !== 'detecting-face' && cur !== 'detecting-eyes' && cur !== 'waiting-for-blink') return;
    const devices = camera.devices;
    if (devices.length < 2) return;

    const e = engineRef.current;
    const id = e.scanId;
    const idx = devices.findIndex((d) => d.deviceId === camera.activeDeviceId);
    const next = devices[(idx + 1) % devices.length];

    switchingRef.current = true;
    e.paused = true;
    try {
      await startCamera(next.deviceId); // CameraController stops the old stream first: never two streams
    } catch (err) {
      if (err instanceof ScanError && err.code === 'aborted') return;
      finishFailed(id, err instanceof ScanError ? err.code : 'unknown');
      return;
    } finally {
      switchingRef.current = false;
    }
    if (e.scanId !== id) return;

    e.detector.reset();
    e.stableFrames = 0;
    e.preFrames = [];
    e.prevFaceCenter = undefined;
    e.lastVideoTime = -1;
    if (stateRef.current !== 'detecting-face') go('detecting-face');
    e.paused = false;
  }, [camera.devices, camera.activeDeviceId, startCamera, finishFailed, go]);

  // Stop everything if the page is hidden mid-scan (tab switch, app switch, screen lock).
  useEffect(() => {
    const onHidden = () => {
      if (document.hidden && (isActiveState(stateRef.current) || stateRef.current === 'requesting-camera')) {
        endScan('stopped', 'The scan was stopped because the page was hidden. Camera released.');
      }
    };
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', onHidden);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', onHidden);
    };
  }, [endScan]);

  // Unmount: invalidate async work, stop the loop and free the model. (useCamera stops the stream itself.)
  useEffect(() => {
    const e = engineRef.current;
    return () => {
      e.scanId++;
      e.running = false;
      if (e.rafId) cancelAnimationFrame(e.rafId);
      e.preFrames = [];
      e.postFrames = [];
      releaseCanvas(e.scratch);
      e.scratch = null;
      e.landmarker = null;
      closeFaceLandmarker();
    };
  }, []);

  let progress = 0;
  switch (state) {
    case 'requesting-camera':
      progress = 0.03;
      break;
    case 'initializing-model':
      progress = 0.08;
      break;
    case 'detecting-face':
      progress = 0.15;
      break;
    case 'detecting-eyes':
      progress = 0.3;
      break;
    case 'waiting-for-blink':
      progress = 0.5;
      break;
    case 'blink-detected':
      progress = 0.7;
      break;
    case 'capturing-frames':
      progress = 0.7 + 0.2 * Math.min(1, framesCaptured / (POST_FRAMES_TARGET + MAX_PRE_FRAMES));
      break;
    case 'analyzing-quality':
      progress = 0.95;
      break;
    case 'completed':
      progress = 1;
      break;
    default:
      progress = 0;
  }

  return {
    state,
    message,
    guidance,
    error,
    notice,
    result,
    frame,
    blinkCount,
    framesCaptured,
    progress,
    openness,
    blinkConfidence,
    videoRef,
    camera,
    canSwitchCamera: camera.devices.length > 1,
    begin,
    cancelScan,
    stopCamera,
    switchCamera,
    goHome,
    clearData,
  };
}
