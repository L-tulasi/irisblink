import { describe, expect, it } from 'vitest';
import {
  ACTIVE_STATES,
  ALLOWED_TRANSITIONS,
  canStartScan,
  canTransition,
  isActiveState,
  nextState,
  STATE_MESSAGES,
} from '../vision/scanMachine';
import type { ScanState } from '../types/scanner';

const ALL_STATES = Object.keys(ALLOWED_TRANSITIONS) as ScanState[];

describe('scan state machine', () => {
  it('defines all twelve states with a user-facing message', () => {
    expect(ALL_STATES).toHaveLength(12);
    for (const s of ALL_STATES) expect(STATE_MESSAGES[s].length).toBeGreaterThan(0);
  });

  it('follows the happy path from idle to completed', () => {
    const path: ScanState[] = [
      'idle',
      'requesting-camera',
      'initializing-model',
      'detecting-face',
      'detecting-eyes',
      'waiting-for-blink',
      'blink-detected',
      'capturing-frames',
      'analyzing-quality',
      'completed',
    ];
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i], path[i + 1])).toBe(true);
    }
  });

  it('blocks skipping steps (e.g. no capture without a blink)', () => {
    expect(canTransition('idle', 'capturing-frames')).toBe(false);
    expect(canTransition('waiting-for-blink', 'capturing-frames')).toBe(false);
    expect(canTransition('detecting-face', 'completed')).toBe(false);
    expect(canTransition('analyzing-quality', 'blink-detected')).toBe(false);
  });

  it('never reports success from a failed or stopped scan (no stale result can revive it)', () => {
    expect(canTransition('failed', 'completed')).toBe(false);
    expect(canTransition('stopped', 'completed')).toBe(false);
    expect(canTransition('completed', 'capturing-frames')).toBe(false);
  });

  it('allows every active state to fail or be stopped', () => {
    for (const s of ACTIVE_STATES) {
      expect(canTransition(s, 'failed')).toBe(true);
      expect(canTransition(s, 'stopped')).toBe(true);
    }
    expect(canTransition('requesting-camera', 'failed')).toBe(true);
    expect(canTransition('requesting-camera', 'stopped')).toBe(true);
  });

  it('prevents duplicate scan starts but allows retry after a terminal state', () => {
    for (const s of ACTIVE_STATES) expect(canStartScan(s)).toBe(false);
    expect(canStartScan('requesting-camera')).toBe(false);
    for (const s of ['idle', 'completed', 'failed', 'stopped'] as const) expect(canStartScan(s)).toBe(true);
    for (const s of ['completed', 'failed', 'stopped'] as const) expect(canTransition(s, 'requesting-camera')).toBe(true);
  });

  it('lets detection step back when the face is lost', () => {
    expect(canTransition('detecting-eyes', 'detecting-face')).toBe(true);
    expect(canTransition('waiting-for-blink', 'detecting-face')).toBe(true);
  });

  it('nextState keeps the current state on an illegal move', () => {
    expect(nextState('idle', 'completed')).toBe('idle');
    expect(nextState('idle', 'requesting-camera')).toBe('requesting-camera');
  });

  it('isActiveState matches the camera-running states', () => {
    expect(isActiveState('waiting-for-blink')).toBe(true);
    expect(isActiveState('idle')).toBe(false);
    expect(isActiveState('completed')).toBe(false);
  });
});
