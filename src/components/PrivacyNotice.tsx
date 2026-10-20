interface Props {
  /** Short version for the welcome screen; full version for Settings & privacy. */
  variant?: 'short' | 'full';
}

export function PrivacyNotice({ variant = 'short' }: Props) {
  if (variant === 'short') {
    return (
      <section className="panel notice" aria-labelledby="privacy-short">
        <h2 id="privacy-short">Privacy</h2>
        <p>
          Video frames are processed on this device, in your browser. Images are not uploaded and there is no
          analytics. Nothing is saved after you leave the results screen.
        </p>
      </section>
    );
  }

  return (
    <section className="panel notice" aria-labelledby="privacy-full">
      <h2 id="privacy-full">What is processed, and where</h2>
      <ul className="plain-list">
        <li>
          <strong>Camera video</strong> (no audio, no microphone) is analysed frame by frame in your browser to
          find face and eye landmarks. Frames are not recorded.
        </li>
        <li>
          <strong>Eye crops</strong> from a few frames are held in memory only to measure brightness and
          sharpness. They are discarded when the scan ends or you clear data. Nothing is written to
          localStorage, IndexedDB or any server.
        </li>
        <li>
          <strong>No uploads, no analytics.</strong> The app has no backend and sends no images anywhere.
        </li>
        <li>
          <strong>No biometric template is created or stored.</strong> The unwrapped iris strip on the results
          screen is an experimental visualisation, not an identity template, and cannot be used to identify
          anyone.
        </li>
      </ul>

      <h3>Limits of this privacy model</h3>
      <ul className="plain-list">
        <li>
          By default the first scan downloads the MediaPipe WASM runtime (cdn.jsdelivr.net) and the face
          landmark model (storage.googleapis.com). Those hosts see a normal web request from your IP address,
          but never your images. The app is therefore <strong>not fully offline</strong> unless you self-host
          those files (see the README).
        </li>
        <li>
          The page itself is delivered by whichever host serves it. A malicious or compromised host could
          change the code, so only use deployments you trust.
        </li>
        <li>Browser extensions and screen-recording software on your device can still see the camera preview.</li>
      </ul>

      <h3>Prototype notice</h3>
      <p>
        IrisBlink is an educational computer-vision prototype. It is <strong>not</strong> an authentication or
        identity-verification system. A detected blink does not prove that a live person is present, and
        ordinary colour cameras generally do not capture enough iris detail for reliable iris biometrics
        (real systems use near-infrared imaging).
      </p>
    </section>
  );
}
