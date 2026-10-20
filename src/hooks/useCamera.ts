import { useCallback, useEffect, useRef, useState } from 'react';
import { ScanError } from '../types/scanner';

/** Maps getUserMedia / DOMException failures to a ScanError with a friendly code. */
export function mapCameraError(err: unknown): ScanError {
  if (err instanceof ScanError) return err;
  const name =
    err && typeof err === 'object' && 'name' in err ? String((err as { name: unknown }).name) : '';
  const detail = err instanceof Error ? err.message : undefined;
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return new ScanError('permission-denied', detail);
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return new ScanError('no-camera', detail);
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return new ScanError('camera-in-use', detail);
    case 'TypeError':
      return new ScanError('unsupported-browser', detail);
    default:
      return new ScanError('unknown', detail);
  }
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

type MediaDevicesGetter = () => MediaDevices | undefined;

const defaultGetter: MediaDevicesGetter = () =>
  typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;

/**
 * Owns at most ONE camera stream at a time. Framework-free so it can be unit-tested with a mocked
 * `navigator.mediaDevices`.
 *
 * - Video only (audio is never requested).
 * - `start()` always stops any previous stream first and ignores results of superseded calls,
 *   so overlapping starts can never leave a second stream running.
 * - `stop()` stops every track and invalidates in-flight starts.
 */
export class CameraController {
  onInterrupted: (() => void) | null = null;
  private stream: MediaStream | null = null;
  private token = 0;
  private listeners: Array<{ track: MediaStreamTrack; fn: () => void }> = [];
  private readonly getMediaDevices: MediaDevicesGetter;

  constructor(getMediaDevices: MediaDevicesGetter = defaultGetter) {
    this.getMediaDevices = getMediaDevices;
  }

  get active(): boolean {
    return this.stream !== null;
  }

  get currentStream(): MediaStream | null {
    return this.stream;
  }

  get activeDeviceId(): string | null {
    return this.stream?.getVideoTracks()[0]?.getSettings().deviceId ?? null;
  }

  /** Mirror preview unless the track reports a rear ("environment") camera. */
  get mirrored(): boolean {
    return this.stream?.getVideoTracks()[0]?.getSettings().facingMode !== 'environment';
  }

  async start(deviceId?: string): Promise<MediaStream> {
    const md = this.getMediaDevices();
    if (!md || typeof md.getUserMedia !== 'function') throw new ScanError('unsupported-browser');

    this.stop();
    const myToken = ++this.token;

    const size = { width: { ideal: 1280 }, height: { ideal: 720 } };
    const preferred: MediaStreamConstraints = {
      audio: false,
      video: deviceId ? { deviceId: { exact: deviceId }, ...size } : { facingMode: 'user', ...size },
    };

    let stream: MediaStream;
    try {
      try {
        stream = await md.getUserMedia(preferred);
      } catch (err) {
        const overconstrained = err && typeof err === 'object' && 'name' in err && (err as { name: unknown }).name === 'OverconstrainedError';
        if (!overconstrained || deviceId) throw err;
        // Resolution/facing constraints were not satisfiable: fall back to any camera.
        stream = await md.getUserMedia({ audio: false, video: true });
      }
    } catch (err) {
      if (myToken !== this.token) throw new ScanError('aborted');
      throw mapCameraError(err);
    }

    if (myToken !== this.token) {
      stopTracks(stream); // a newer start()/stop() superseded this call
      throw new ScanError('aborted');
    }

    this.stream = stream;
    for (const track of stream.getVideoTracks()) {
      const fn = () => {
        if (this.stream !== stream) return;
        this.stop();
        this.onInterrupted?.();
      };
      track.addEventListener('ended', fn);
      this.listeners.push({ track, fn });
    }
    return stream;
  }

  async listVideoDevices(): Promise<MediaDeviceInfo[]> {
    const md = this.getMediaDevices();
    if (!md || typeof md.enumerateDevices !== 'function') return [];
    try {
      const all = await md.enumerateDevices();
      return all.filter((d) => d.kind === 'videoinput');
    } catch {
      return [];
    }
  }

  stop(): void {
    this.token++;
    for (const { track, fn } of this.listeners) track.removeEventListener('ended', fn);
    this.listeners = [];
    if (this.stream) stopTracks(this.stream);
    this.stream = null;
  }
}

export type CameraStatus = 'idle' | 'starting' | 'active' | 'error';

export interface UseCamera {
  stream: MediaStream | null;
  status: CameraStatus;
  error: ScanError | null;
  devices: MediaDeviceInfo[];
  activeDeviceId: string | null;
  mirrored: boolean;
  start: (deviceId?: string) => Promise<MediaStream>;
  stop: () => void;
}

export function useCamera(onInterrupted?: () => void): UseCamera {
  const [controller] = useState(() => new CameraController());
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>('idle');
  const [error, setError] = useState<ScanError | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(null);
  const [mirrored, setMirrored] = useState(true);

  const interruptedRef = useRef(onInterrupted);
  useEffect(() => {
    interruptedRef.current = onInterrupted;
  }, [onInterrupted]);

  // Stop the camera when the owning component unmounts.
  useEffect(() => {
    controller.onInterrupted = () => {
      setStream(null);
      setStatus('idle');
      interruptedRef.current?.();
    };
    return () => {
      controller.onInterrupted = null;
      controller.stop();
    };
  }, [controller]);

  const start = useCallback(
    async (deviceId?: string) => {
      setStatus('starting');
      setError(null);
      try {
        const s = await controller.start(deviceId);
        const list = await controller.listVideoDevices();
        setStream(s);
        setDevices(list);
        setActiveDeviceId(controller.activeDeviceId);
        setMirrored(controller.mirrored);
        setStatus('active');
        return s;
      } catch (err) {
        const se = err instanceof ScanError ? err : mapCameraError(err);
        if (se.code !== 'aborted') {
          setStream(null);
          setStatus('error');
          setError(se);
        }
        throw se;
      }
    },
    [controller],
  );

  const stop = useCallback(() => {
    controller.stop();
    setStream(null);
    setStatus('idle');
  }, [controller]);

  return { stream, status, error, devices, activeDeviceId, mirrored, start, stop };
}
