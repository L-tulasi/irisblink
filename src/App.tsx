import { useState } from 'react';
import { CameraView } from './components/CameraView';
import { PrivacyNotice } from './components/PrivacyNotice';
import { ScanProgress } from './components/ScanProgress';
import { ScanResults } from './components/ScanResults';
import { useIrisScanner } from './hooks/useIrisScanner';
import { isActiveState } from './vision/scanMachine';
import { ERROR_COPY, type ScanErrorCode } from './types/scanner';

type View = 'welcome' | 'permission' | 'settings';

/** Failures that happen before any eye analysis: shown on the camera-permission screen with retry help. */
const CAMERA_STAGE_CODES: readonly ScanErrorCode[] = [
  'permission-denied',
  'no-camera',
  'camera-in-use',
  'unsupported-browser',
  'model-failed',
  'camera-interrupted',
];

const SWITCHABLE = ['detecting-face', 'detecting-eyes', 'waiting-for-blink'];

const FACE_LABEL = { none: 'No face', multiple: 'Multiple faces', detected: 'Face detected' } as const;
const EYE_LABEL = {
  none: 'Eyes not found',
  'too-small': 'Eyes too small',
  'off-axis': 'Look at camera',
  ok: 'Eyes detected',
} as const;

export default function App() {
  const s = useIrisScanner();
  const [view, setView] = useState<View>('welcome');
  const [cleared, setCleared] = useState(false);

  const cameraOn = s.camera.status === 'active';
  const cameraStageFailure = s.state === 'failed' && s.error !== null && CAMERA_STAGE_CODES.includes(s.error.code);

  let screen: 'welcome' | 'permission' | 'live' | 'results' | 'settings';
  if (isActiveState(s.state)) screen = 'live';
  else if (s.state === 'completed' || (s.state === 'failed' && !cameraStageFailure)) screen = 'results';
  else if (view === 'settings') screen = 'settings';
  else if (s.state === 'requesting-camera' || s.state === 'stopped' || cameraStageFailure || view === 'permission')
    screen = 'permission';
  else screen = 'welcome';

  const goHome = () => {
    s.goHome();
    setView('welcome');
  };

  return (
    <div className="app">
      <header className="app-header">
        <button type="button" className="brand" onClick={screen === 'live' ? undefined : goHome} disabled={screen === 'live'}>
          <span className="brand-mark" aria-hidden="true" />
          IrisBlink
        </button>
        <div className="header-right">
          <span className={`camera-chip ${cameraOn ? 'on' : 'off'}`} role="status">
            <span aria-hidden="true">●</span> Camera {cameraOn ? 'on' : 'off'}
          </span>
          {screen !== 'live' && (
            <button
              type="button"
              className="btn small"
              onClick={() => {
                setCleared(false);
                setView(view === 'settings' ? 'welcome' : 'settings');
              }}
            >
              {screen === 'settings' ? 'Close' : 'Settings & privacy'}
            </button>
          )}
        </div>
      </header>

      <main className="app-main">
        {screen === 'welcome' && (
          <div className="stack">
            <section className="panel hero" aria-labelledby="welcome-title">
              <h1 id="welcome-title">IrisBlink</h1>
              <p className="lead">
                A browser-based computer-vision experiment: find your face and eyes, watch for one natural blink,
                capture a few clear eye frames, and report how good they are.
              </p>
              <ol className="how">
                <li>Allow the camera and face the light.</li>
                <li>Center your face, look at the camera and hold still.</li>
                <li>Blink naturally when prompted.</li>
                <li>Review the quality metrics and the estimated iris region.</li>
              </ol>
              <div className="alert warn" role="note">
                <strong>Prototype, not authentication.</strong> This does not verify who you are, and a detected blink
                does not prove a live person. Ordinary RGB cameras usually cannot capture reliable iris detail.
              </div>
              <div className="button-row">
                <button type="button" className="btn primary" onClick={() => setView('permission')}>
                  Start Scan
                </button>
              </div>
            </section>
            <PrivacyNotice variant="short" />
          </div>
        )}

        {screen === 'permission' && (
          <section className="panel narrow" aria-labelledby="perm-title">
            <h1 id="perm-title">Camera access</h1>
            <p>
              IrisBlink needs your camera to see your face and eyes. Video only, no microphone. Frames are processed
              on this device and are not uploaded or saved.
            </p>

            {s.state === 'stopped' && s.notice && (
              <div className="alert" role="status">
                {s.notice}
              </div>
            )}

            {cameraStageFailure && s.error && (
              <div className="alert" role="alert">
                <strong>{ERROR_COPY[s.error.code].title}.</strong> {ERROR_COPY[s.error.code].advice}
                {s.error.code === 'model-failed' && s.error.message !== ERROR_COPY['model-failed'].title && (
                  <details className="small">
                    <summary>Technical detail</summary>
                    <code>{s.error.message}</code>
                  </details>
                )}
              </div>
            )}

            <p className="muted small">
              Camera access only works on HTTPS pages (or localhost). The first scan also downloads the face-landmark
              model, so it may take a few seconds.
            </p>

            <div className="button-row">
              <button type="button" className="btn primary" onClick={() => void s.begin()} disabled={s.state === 'requesting-camera'}>
                {s.state === 'requesting-camera'
                  ? 'Waiting for permission...'
                  : cameraStageFailure || s.state === 'stopped'
                    ? 'Retry'
                    : 'Start Camera'}
              </button>
              {s.state === 'requesting-camera' ? (
                <button type="button" className="btn" onClick={s.cancelScan}>
                  Cancel
                </button>
              ) : (
                <button type="button" className="btn" onClick={goHome}>
                  Back
                </button>
              )}
            </div>
          </section>
        )}

        {screen === 'live' && (
          <div className="live">
            <div className="live-camera">
              <CameraView
                stream={s.camera.stream}
                videoRef={s.videoRef}
                mirrored={s.camera.mirrored}
                landmarks={s.frame?.landmarks ?? null}
              />
            </div>

            <section className="panel live-side" aria-label="Scan status">
              <div className="chips" aria-label="Detection status">
                <span className={`chip ${s.frame?.assessment.faceStatus === 'detected' ? 'ok' : ''}`}>
                  {FACE_LABEL[s.frame?.assessment.faceStatus ?? 'none']}
                </span>
                <span className={`chip ${s.frame?.assessment.eyeStatus === 'ok' ? 'ok' : ''}`}>
                  {EYE_LABEL[s.frame?.assessment.eyeStatus ?? 'none']}
                </span>
              </div>

              <p className="status-message" role="status" aria-live="polite">
                {s.message}
              </p>
              <p className="guidance" aria-live="polite">
                {s.guidance || 'Center your face in the circle.'}
              </p>

              <ScanProgress
                state={s.state}
                progress={s.progress}
                openness={s.openness}
                blinkCount={s.blinkCount}
                blinkConfidence={s.blinkConfidence}
              />

              <div className="button-row">
                {s.canSwitchCamera && SWITCHABLE.includes(s.state) && (
                  <button type="button" className="btn" onClick={() => void s.switchCamera()}>
                    Switch camera
                  </button>
                )}
                <button type="button" className="btn" onClick={s.stopCamera}>
                  Stop Camera
                </button>
                <button type="button" className="btn danger" onClick={() => { s.cancelScan(); setView('welcome'); }}>
                  Cancel Scan
                </button>
              </div>
            </section>
          </div>
        )}

        {screen === 'results' && s.result && (
          <ScanResults result={s.result} onScanAgain={() => void s.begin()} onHome={goHome} />
        )}

        {screen === 'settings' && (
          <div className="stack">
            <PrivacyNotice variant="full" />
            <section className="panel narrow" aria-labelledby="data-title">
              <h2 id="data-title">Your data</h2>
              <p>
                IrisBlink keeps no persistent data. Clearing removes any scan result and eye images held in memory for
                this session.
              </p>
              <div className="button-row">
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    s.clearData();
                    setCleared(true);
                  }}
                >
                  Clear temporary scan data
                </button>
                <button type="button" className="btn" onClick={s.stopCamera} disabled={!cameraOn}>
                  Stop camera
                </button>
              </div>
              {cleared && (
                <p role="status" className="muted small">
                  Temporary scan data cleared.
                </p>
              )}
            </section>
          </div>
        )}
      </main>

      <footer className="app-footer">
        Educational prototype. Not an authentication or identity-verification system.
      </footer>
    </div>
  );
}
