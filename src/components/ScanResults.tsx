import { ERROR_COPY, type ScanErrorCode, type ScanResult } from '../types/scanner';
import { QUALITY_REASON_TEXT } from '../vision/imageQuality';

interface Props {
  result: ScanResult;
  onScanAgain: () => void;
  onHome: () => void;
}

function Row({ label, ok, value }: { label: string; ok?: boolean; value: string }) {
  return (
    <div className="result-row">
      <dt>{label}</dt>
      <dd>
        {ok !== undefined && (
          <span className={ok ? 'badge ok' : 'badge bad'}>{ok ? 'Yes' : 'No'}</span>
        )}{' '}
        {value}
      </dd>
    </div>
  );
}

const ALWAYS_POSSIBLE_REASONS: Array<[string, string]> = [
  ['Lighting', 'Dim rooms, strong backlight, or glare on glasses hide the eye.'],
  ['Distance', 'The eye needs to be large enough in the image. Move closer if the guidance asks.'],
  ['Motion', 'Head movement or camera shake blurs the crop and can break blink detection.'],
  ['Camera quality', 'Ordinary RGB cameras may not resolve enough iris detail; this is expected.'],
  ['Occlusion', 'Hair, thick frames, heavy eyelashes or half-closed eyes reduce visibility.'],
];

export function ScanResults({ result, onScanAgain, onHome }: Props) {
  const code: ScanErrorCode | null = result.failureCode;
  const copy = code ? ERROR_COPY[code] : null;
  const reasons = result.verdict?.reasons ?? [];

  return (
    <section className="panel results" aria-labelledby="results-title">
      <h1 id="results-title">{result.success ? 'Scan complete' : 'Scan did not complete'}</h1>

      {result.success ? (
        <p className="lead" role="status">
          A usable eye crop was captured. This is a quality check only: it does not identify or verify anyone.
        </p>
      ) : (
        copy && (
          <div className="alert" role="alert">
            <strong>{copy.title}.</strong> {copy.advice}
          </div>
        )
      )}

      <dl className="result-list">
        <Row label="Eye detected" ok={result.eyeDetected} value={result.eyeSide ? `(${result.eyeSide} eye used)` : ''} />
        <Row label="Blink observed" ok={result.blinkObserved} value={result.blinkObserved ? `confidence about ${Math.round(result.blinkConfidence * 100)}%` : ''} />
        <Row label="Blink events" value={String(result.blinkCount)} />
        <Row label="Frames captured" value={`${result.framesCaptured} (${result.framesAccepted} passed quality checks)`} />
        <Row
          label="Iris localization"
          value={
            result.irisStatus === 'estimated'
              ? `Estimated iris region (radius about ${result.irisRadiusPx?.toFixed(1)} px). This is a landmark-based estimate, not a verified segmentation.`
              : 'Not localized. No reliable iris region was produced.'
          }
        />
      </dl>

      {result.metrics && (
        <>
          <h2>Image quality</h2>
          <dl className="result-list">
            <Row label="Crop size" value={`${result.metrics.width} × ${result.metrics.height} px`} />
            <Row label="Brightness" value={`${result.metrics.brightness.toFixed(0)} / 255`} />
            <Row label="Sharpness (Laplacian variance)" value={result.metrics.sharpness.toFixed(1)} />
            <Row
              label="Over-/under-exposed pixels"
              value={`${(result.metrics.overexposedFraction * 100).toFixed(1)}% / ${(result.metrics.underexposedFraction * 100).toFixed(1)}%`}
            />
          </dl>
          {reasons.length > 0 && (
            <ul className="plain-list">
              {reasons.map((r) => (
                <li key={r}>{QUALITY_REASON_TEXT[r]}</li>
              ))}
            </ul>
          )}
        </>
      )}

      {result.success && result.cropUrl && (
        <>
          <h2>Captured eye crop</h2>
          <div className="crops">
            <figure>
              <img src={result.boundaryUrl ?? result.cropUrl} alt="Eye crop with the estimated iris boundary outlined" />
              <figcaption>{result.boundaryUrl ? 'Estimated iris boundary' : 'Eye crop (iris not localized)'}</figcaption>
            </figure>
            {result.unwrappedUrl && (
              <figure>
                <img className="strip" src={result.unwrappedUrl} alt="Experimental unwrapped iris strip" />
                <figcaption>
                  Experimental unwrapped strip. Visualization only: not a biometric template, not usable for matching.
                </figcaption>
              </figure>
            )}
          </div>
        </>
      )}

      <details className="why">
        <summary>Why might a scan fail?</summary>
        <ul className="plain-list">
          {ALWAYS_POSSIBLE_REASONS.map(([title, text]) => (
            <li key={title}>
              <strong>{title}.</strong> {text}
            </li>
          ))}
        </ul>
      </details>

      <p className="muted small">
        Everything shown here is held in memory only. It disappears when you return home or clear data.
      </p>

      <div className="button-row">
        <button type="button" className="btn primary" onClick={onScanAgain}>
          Scan again
        </button>
        <button type="button" className="btn" onClick={onHome}>
          Return home
        </button>
      </div>
    </section>
  );
}
