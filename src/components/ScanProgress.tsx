import type { ScanState } from '../types/scanner';

interface Props {
  state: ScanState;
  progress: number;
  openness: number;
  blinkCount: number;
  blinkConfidence: number;
}

const ORDER: ScanState[] = [
  'detecting-face',
  'detecting-eyes',
  'waiting-for-blink',
  'blink-detected',
  'capturing-frames',
  'analyzing-quality',
  'completed',
];

function reached(state: ScanState, target: ScanState): boolean {
  return ORDER.indexOf(state) >= ORDER.indexOf(target);
}

const RADIUS = 54;
const CIRC = 2 * Math.PI * RADIUS;

/** Circular scan indicator, step checklist and a live eye-openness (blink) meter. */
export function ScanProgress({ state, progress, openness, blinkCount, blinkConfidence }: Props) {
  const pct = Math.round(progress * 100);
  const steps: Array<{ label: string; done: boolean }> = [
    { label: 'Face found', done: reached(state, 'detecting-eyes') },
    { label: 'Eyes locked', done: reached(state, 'waiting-for-blink') },
    { label: 'Blink observed', done: reached(state, 'blink-detected') },
    { label: 'Frames captured', done: reached(state, 'analyzing-quality') },
  ];

  return (
    <div className="progress-block">
      <div
        className="ring"
        role="progressbar"
        aria-label="Scan progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <svg viewBox="0 0 128 128" width="128" height="128" aria-hidden="true">
          <circle cx="64" cy="64" r={RADIUS} className="ring-track" />
          <circle
            cx="64"
            cy="64"
            r={RADIUS}
            className="ring-value"
            strokeDasharray={CIRC}
            strokeDashoffset={CIRC * (1 - progress)}
            transform="rotate(-90 64 64)"
          />
        </svg>
        <span className="ring-label">{pct}%</span>
      </div>

      <ul className="steps">
        {steps.map((s) => (
          <li key={s.label} className={s.done ? 'done' : undefined}>
            <span aria-hidden="true">{s.done ? '✓' : '○'}</span> {s.label}
            <span className="sr-only">{s.done ? ' (done)' : ' (pending)'}</span>
          </li>
        ))}
      </ul>

      <div className="meter-wrap">
        <label htmlFor="openness">Eye openness (blink signal)</label>
        <meter id="openness" min={0} max={1} value={openness} aria-valuetext={`${Math.round(openness * 100)} percent open`} />
        <p className="muted small">
          Blinks counted: <strong>{blinkCount}</strong>
          {blinkCount > 0 && <> · detection confidence about {Math.round(blinkConfidence * 100)}%</>}
        </p>
      </div>
    </div>
  );
}
