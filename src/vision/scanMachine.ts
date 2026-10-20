import type { ScanState } from '../types/scanner';

/**
 * Explicit scan state machine. `ALLOWED_TRANSITIONS` is the single source of truth;
 * the scanner hook refuses any move that is not listed here.
 *
 * The three "terminal" states (completed, failed, stopped) may only be left by starting a
 * new scan (requesting-camera) or returning to idle, which prevents a stale async result
 * from reviving a finished scan.
 */
export const ALLOWED_TRANSITIONS: Record<ScanState, readonly ScanState[]> = {
  idle: ['requesting-camera'],
  'requesting-camera': ['initializing-model', 'failed', 'stopped'],
  'initializing-model': ['detecting-face', 'failed', 'stopped'],
  'detecting-face': ['detecting-eyes', 'failed', 'stopped'],
  'detecting-eyes': ['waiting-for-blink', 'detecting-face', 'failed', 'stopped'],
  'waiting-for-blink': ['blink-detected', 'detecting-face', 'detecting-eyes', 'failed', 'stopped'],
  'blink-detected': ['capturing-frames', 'failed', 'stopped'],
  'capturing-frames': ['analyzing-quality', 'failed', 'stopped'],
  'analyzing-quality': ['completed', 'failed', 'stopped'],
  completed: ['idle', 'requesting-camera'],
  failed: ['idle', 'requesting-camera'],
  stopped: ['idle', 'requesting-camera'],
};

/** States in which the camera is expected to be running and the scan loop is active. */
export const ACTIVE_STATES: readonly ScanState[] = [
  'initializing-model',
  'detecting-face',
  'detecting-eyes',
  'waiting-for-blink',
  'blink-detected',
  'capturing-frames',
  'analyzing-quality',
];

/** States from which a brand-new scan may be started. */
export const STARTABLE_STATES: readonly ScanState[] = ['idle', 'completed', 'failed', 'stopped'];

export function canTransition(from: ScanState, to: ScanState): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function isActiveState(state: ScanState): boolean {
  return ACTIVE_STATES.includes(state);
}

export function canStartScan(state: ScanState): boolean {
  return STARTABLE_STATES.includes(state);
}

/** Returns `to` when the move is legal, otherwise `from` (state unchanged). */
export function nextState(from: ScanState, to: ScanState): ScanState {
  return canTransition(from, to) ? to : from;
}

export const STATE_MESSAGES: Record<ScanState, string> = {
  idle: 'Ready when you are.',
  'requesting-camera': 'Requesting camera access...',
  'initializing-model': 'Loading the face-landmark model...',
  'detecting-face': 'Looking for your face...',
  'detecting-eyes': 'Face found. Checking that both eyes are visible...',
  'waiting-for-blink': 'Eyes locked. Blink naturally.',
  'blink-detected': 'Blink detected.',
  'capturing-frames': 'Capturing eye frames. Keep your eyes open and hold still.',
  'analyzing-quality': 'Checking image quality...',
  completed: 'Scan complete.',
  failed: 'Scan failed.',
  stopped: 'Scan stopped.',
};
