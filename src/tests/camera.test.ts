import { describe, expect, it, vi } from 'vitest';
import { CameraController, mapCameraError } from '../hooks/useCamera';
import { ScanError } from '../types/scanner';

/** Minimal fake MediaStream whose tracks record stop() and dispatch 'ended'. */
function fakeStream(deviceId = 'cam-1') {
  const listeners = new Map<string, Set<() => void>>();
  const track = {
    stop: vi.fn(),
    addEventListener: (type: string, fn: () => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener: (type: string, fn: () => void) => listeners.get(type)?.delete(fn),
    getSettings: () => ({ deviceId, facingMode: 'user' }),
    fire: (type: string) => listeners.get(type)?.forEach((fn) => fn()),
  };
  const stream = {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  };
  return { stream: stream as unknown as MediaStream, track };
}

function fakeMediaDevices(impl: (c: MediaStreamConstraints) => Promise<MediaStream>) {
  return {
    getUserMedia: vi.fn(impl),
    enumerateDevices: vi.fn(async () => [
      { kind: 'videoinput', deviceId: 'cam-1', label: 'Front' },
      { kind: 'audioinput', deviceId: 'mic-1', label: 'Mic' },
      { kind: 'videoinput', deviceId: 'cam-2', label: 'Back' },
    ]),
  } as unknown as MediaDevices;
}

const domError = (name: string) => Object.assign(new Error(name), { name });

describe('mapCameraError', () => {
  it('maps browser errors to friendly codes', () => {
    expect(mapCameraError(domError('NotAllowedError')).code).toBe('permission-denied');
    expect(mapCameraError(domError('NotFoundError')).code).toBe('no-camera');
    expect(mapCameraError(domError('NotReadableError')).code).toBe('camera-in-use');
    expect(mapCameraError(domError('TypeError')).code).toBe('unsupported-browser');
    expect(mapCameraError(domError('Weird')).code).toBe('unknown');
  });
});

describe('CameraController', () => {
  it('requests video only (no audio) and prefers the front camera', async () => {
    const md = fakeMediaDevices(async () => fakeStream().stream);
    const cam = new CameraController(() => md);
    await cam.start();
    const constraints = vi.mocked(md.getUserMedia).mock.calls[0][0];
    expect(constraints?.audio).toBe(false);
    expect(constraints?.video).toMatchObject({ facingMode: 'user' });
  });

  it('stop() stops every track and clears the stream', async () => {
    const { stream, track } = fakeStream();
    const cam = new CameraController(() => fakeMediaDevices(async () => stream));
    await cam.start();
    expect(cam.active).toBe(true);
    cam.stop();
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(cam.active).toBe(false);
  });

  it('never keeps two streams: a second start() stops the first', async () => {
    const a = fakeStream('cam-1');
    const b = fakeStream('cam-2');
    const queue = [a.stream, b.stream];
    const cam = new CameraController(() => fakeMediaDevices(async () => queue.shift()!));
    await cam.start();
    await cam.start('cam-2');
    expect(a.track.stop).toHaveBeenCalled();
    expect(b.track.stop).not.toHaveBeenCalled();
    expect(cam.activeDeviceId).toBe('cam-2');
  });

  it('discards a stream that arrives after stop() (stale async result)', async () => {
    const { stream, track } = fakeStream();
    let release!: (s: MediaStream) => void;
    const pending = new Promise<MediaStream>((r) => (release = r));
    const cam = new CameraController(() => fakeMediaDevices(() => pending));
    const started = cam.start();
    cam.stop(); // user cancelled while the permission prompt was open
    release(stream);
    await expect(started).rejects.toMatchObject({ code: 'aborted' });
    expect(track.stop).toHaveBeenCalled();
    expect(cam.active).toBe(false);
  });

  it('reports permission denial as a ScanError', async () => {
    const cam = new CameraController(() => fakeMediaDevices(async () => Promise.reject(domError('NotAllowedError'))));
    const err = await cam.start().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ScanError);
    expect((err as ScanError).code).toBe('permission-denied');
  });

  it('falls back to generic video constraints when the preferred ones are overconstrained', async () => {
    let calls = 0;
    const md = fakeMediaDevices(async () => {
      calls++;
      if (calls === 1) throw domError('OverconstrainedError');
      return fakeStream().stream;
    });
    const cam = new CameraController(() => md);
    await cam.start();
    expect(calls).toBe(2);
    expect(cam.active).toBe(true);
  });

  it('reports unsupported browsers when mediaDevices is missing', async () => {
    const cam = new CameraController(() => undefined);
    await expect(cam.start()).rejects.toMatchObject({ code: 'unsupported-browser' });
  });

  it('notifies and releases when the camera track ends (disconnect)', async () => {
    const { stream, track } = fakeStream();
    const cam = new CameraController(() => fakeMediaDevices(async () => stream));
    const onInterrupted = vi.fn();
    cam.onInterrupted = onInterrupted;
    await cam.start();
    track.fire('ended');
    expect(onInterrupted).toHaveBeenCalledTimes(1);
    expect(cam.active).toBe(false);
  });

  it('lists only video inputs', async () => {
    const cam = new CameraController(() => fakeMediaDevices(async () => fakeStream().stream));
    const devices = await cam.listVideoDevices();
    expect(devices.map((d) => d.deviceId)).toEqual(['cam-1', 'cam-2']);
  });
});
