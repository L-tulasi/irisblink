# IrisBlink

A responsive PWA (React + TypeScript + Vite) that opens the camera, finds your face and eyes with MediaPipe, waits for one natural blink, captures a few open-eye frames, and reports how good they are: eye detected, blink count, frames captured, brightness, sharpness, and an **estimated** iris region.

> **This is an educational computer-vision prototype. It is not an authentication or identity-verification system.**
> - A detected blink does **not** prove a live human is present (a video of a face blinks too).
> - It does **not** identify or verify anyone. No biometric template is created, stored or matched.
> - MediaPipe iris landmarks are an *iris tracking* estimate, not iris recognition. Ordinary RGB webcams and phone cameras usually do not resolve enough iris texture for real iris biometrics, which use near-infrared imaging. Do not assume your phone has an NIR camera.

## Contents

1. [What it does](#what-it-does)
2. [Setup on macOS (MacBook Air)](#setup-on-macos-macbook-air)
3. [Commands](#commands)
4. [Testing on your phone](#testing-on-your-phone)
5. [Deploying to HTTPS hosting](#deploying-to-https-hosting)
6. [Privacy and offline behavior](#privacy-and-offline-behavior)
7. [How it works](#how-it-works)
8. [Manual test checklist](#manual-test-checklist)
9. [Known limitations](#known-limitations)

## What it does

Screens: Welcome, Camera permission, Live scan, Results, Settings & privacy.

The scan runs an explicit state machine (`src/vision/scanMachine.ts`):

`idle → requesting-camera → initializing-model → detecting-face → detecting-eyes → waiting-for-blink → blink-detected → capturing-frames → analyzing-quality → completed` (or `failed` / `stopped` from any active state). Illegal transitions are refused, a second start while a scan is running is ignored, and every async step checks a scan id so a stale result can never revive a cancelled or finished scan. After `failed`, `stopped` or `completed` you can retry without reloading the page.

## Setup on macOS (MacBook Air)

### 1. Check Node.js and npm

Open **Terminal** (Cmd+Space, type "Terminal") and run:

```bash
node -v
npm -v
```

You need Node.js **18.18 or newer** (20 or 22 LTS recommended). If `node` is not found or is older, install the current LTS from <https://nodejs.org> (macOS installer), or with Homebrew:

```bash
brew install node
```

Close and reopen Terminal, then re-run `node -v` and `npm -v`.

### 2. Extract and run

If you downloaded `irisblink.zip` to your Downloads folder:

```bash
cd ~/Downloads
unzip irisblink.zip
cd irisblink
npm install
npm run dev
```

Vite prints the local address. With default settings it is:

**http://localhost:5173/**

(If port 5173 is busy Vite picks the next free port and prints it; use whatever it prints.) Open it in Chrome, Edge, Firefox or Safari. `localhost` counts as a secure context, so the camera works over plain HTTP there. Allow the camera when the browser asks. Stop the server with `Ctrl+C`.

The first scan downloads the MediaPipe WASM runtime and face model (a few MB), so it needs internet unless you self-host them (see [Privacy and offline behavior](#privacy-and-offline-behavior)).

## Commands

| Task | Command |
| --- | --- |
| Install dependencies | `npm install` |
| Start dev server (http://localhost:5173/) | `npm run dev` |
| Dev server reachable from other devices on your network | `npm run dev:host` |
| Run unit tests once | `npm test` |
| Tests in watch mode | `npm run test:watch` |
| TypeScript check | `npm run typecheck` |
| Lint | `npm run lint` |
| Typecheck + lint + tests | `npm run check` |
| Production build (outputs `dist/`) | `npm run build` |
| Preview the production build (http://localhost:4173/) | `npm run preview` |
| Preview build, reachable from other devices | `npm run preview:host` |
| Optional: self-host MediaPipe files | `npm run vendor:mediapipe` |

## Testing on your phone

### localhost vs your laptop's LAN address

- `http://localhost:5173` always means *the device you are typing it on*. On your phone, `localhost` is the phone itself, not your laptop, so it will not reach the dev server.
- Your laptop also has a **LAN address** on your Wi-Fi network (something like `192.168.1.23`). Another device on the same Wi-Fi can reach the server at `http://<that-address>:5173`, but only if the server listens on the network, which is what `npm run dev:host` does.

Find the address and start the server:

```bash
ipconfig getifaddr en0     # Wi-Fi address on most MacBook Airs; if blank, try en1
npm run dev:host           # Vite prints "Network: http://192.168.x.x:5173/"
```

Put the phone on the **same Wi-Fi** (not a guest network with client isolation) and open that Network URL.

### Camera access needs HTTPS on mobile

Browsers only expose `getUserMedia` on a **secure context**: HTTPS, or `localhost`. A LAN address like `http://192.168.1.23:5173` is plain HTTP and is **not** a secure context, so on a phone the page loads but the camera is blocked (`navigator.mediaDevices` is undefined or access is refused). Do not expect the LAN URL to open the camera. Safari on iPhone will not allow it at all. Use one of these:

1. **Deploy a build to HTTPS hosting** (recommended, simplest, see next section). Takes about two minutes.
2. **An HTTPS tunnel to your dev server**, for example Cloudflare Tunnel (`brew install cloudflared`, then `cloudflared tunnel --url http://localhost:5173`) or ngrok. They print an `https://...` URL that works on the phone. Vite may reject unknown hostnames; if it does, add the tunnel host to `server.allowedHosts` in `vite.config.ts`. Anyone with the URL can load your dev server while the tunnel runs, so stop it when done.
3. **Local HTTPS with a trusted certificate** (for example `mkcert` plus Vite's `server.https` option). The phone must trust the mkcert root CA, which is fiddly on iOS. Prefer option 1 or 2.
4. Android Chrome only, for development: `chrome://flags/#unsafely-treat-insecure-origin-as-secure` can mark one HTTP origin as secure. Not available on iOS.

## Deploying to HTTPS hosting

The build is a static site with relative asset paths, so it works from a domain root or a sub-path. Any static host with HTTPS works. Netlify is the quickest:

**Netlify, drag and drop**

```bash
npm run build
```

Then open <https://app.netlify.com/drop> and drag the generated `dist` folder onto the page. You get an `https://<random-name>.netlify.app` URL immediately; open it on your phone and PC.

**Netlify CLI** (repeatable)

```bash
npm run build
npx netlify-cli deploy --dir=dist --prod
```

Follow the login and site-creation prompts.

**Alternatives:** Cloudflare Pages, Vercel, or GitHub Pages all work with these settings: build command `npm run build`, output directory `dist`, no server code, no special headers. For GitHub Pages, publish the contents of `dist`.

After deploying, verify on a phone: the address starts with `https://`, the browser asks for camera permission, and the app shows "Camera on" in the header during a scan.

Note: the app installs as a PWA (Add to Home Screen) on HTTPS. The service worker only caches the app shell.

## Privacy and offline behavior

Defaults:

- No backend. No image upload. No analytics. No microphone (`audio: false`).
- Video frames are processed in the browser. Eye crops live in memory only, and are dropped when the scan ends, when you return home, or when you press "Clear temporary scan data" in Settings & privacy.
- Nothing is written to localStorage, IndexedDB or cookies. No raw eye images or biometric features are stored.
- The camera is stopped when the scan finishes, fails or is cancelled, when you press Stop Camera, when the page is hidden, and when the component unmounts. The header always shows "Camera on/off".

Limits you should know about:

- **Not offline by default.** On first scan the browser downloads the MediaPipe WASM runtime from `cdn.jsdelivr.net` and the model `face_landmarker.task` from `storage.googleapis.com`. Those hosts see an ordinary web request (IP address, user agent), never your images. The service worker deliberately does not cache those cross-origin files.
- **Self-hosting option.** Run `npm run vendor:mediapipe` once (needs internet). It copies the WASM files to `public/mediapipe/wasm` and downloads the model to `public/models/face_landmarker.task`. Then create `.env.local` from `.env.example` and set `VITE_MEDIAPIPE_WASM_URL=./mediapipe/wasm` and `VITE_FACE_MODEL_URL=./models/face_landmarker.task`, then rebuild. Even then, offline use has **not** been tested by the author, so verify it yourself before relying on it.
- The host serving the page could serve modified code, and browser extensions or screen recorders on your device can see the preview. Browser-side processing is not a security boundary.

## How it works

```
src/
  App.tsx                    screens and routing
  components/                CameraView, ScanOverlay, ScanProgress, ScanResults, PrivacyNotice
  hooks/useCamera.ts         CameraController (single stream, stale-start guard) + React hook
  hooks/useIrisScanner.ts    scan loop, state machine wiring, capture, analysis, cleanup
  vision/initializeVision.ts MediaPipe FaceLandmarker loading (GPU, falls back to CPU)
  vision/faceLandmarks.ts    landmark indices, EAR, eye geometry, user guidance
  vision/blinkDetector.ts    smoothing + open/closed state machine, blink events
  vision/imageQuality.ts     brightness, exposure, Laplacian-variance sharpness, thresholds
  vision/irisProcessor.ts    eye crop, estimated iris circle, experimental unwrapped strip
  vision/scanMachine.ts      allowed state transitions and messages
  types/scanner.ts           shared types and friendly error texts
  tests/                     Vitest unit tests (camera APIs are mocked)
```

**Landmarks.** MediaPipe Tasks Vision `FaceLandmarker` (478 points). Eye contours and the six EAR points use the standard face-mesh indices (documented in `faceLandmarks.ts`); iris centres are landmarks 468 and 473, iris boundary points 469-472 and 474-477. Only the primary face is analysed; two or more faces pause the scan with a message.

**Blink detection.** Eye aspect ratio `EAR = (|p2-p6| + |p3-p5|) / (2|p1-p4|)`, averaged over both eyes, exponentially smoothed, with hysteresis (close below 0.19, reopen at 0.23) and a state machine `unknown → open → closed → open`. One closed-to-open edge is one blink. A closure is discarded if it is shorter than 50 ms (noise), longer than 700 ms (eyes deliberately closed), overlaps large head motion, spans a frame where the face or eyes were not measurable (occlusion), or follows another blink within 250 ms. The reported "confidence" is a heuristic from how deep the dip was, not a probability. All values are in `DEFAULT_BLINK_CONFIG`. They are generic starting points, and glasses, lighting, eye shape and camera angle will move them.

**Capture.** You start the camera explicitly. After the face and both eyes are steady for several frames, the scanner arms blink detection (15 s timeout). It keeps up to two recent "eye clearly open" snapshots from before the blink and, after the eyelids settle, captures up to four more. A frame is only captured when the face is steady, the eyes are large enough, looking at the camera, and EAR shows an open eye, so closed-eye frames are never treated as iris images.

**Quality.** Per eye crop: size, mean brightness, share of over/under-exposed pixels, sharpness as the variance of a 3×3 Laplacian. Thresholds are in `DEFAULT_QUALITY_THRESHOLDS` and are resolution dependent starting points. The scan succeeds only if at least one crop passes every check; otherwise it fails with the dominant reason (lighting, blur or eyes too small). It never reports success when processing failed.

**Iris region.** The "iris boundary" is a circle drawn from MediaPipe iris landmarks and is labelled *estimated*. It is shown only when the landmarks are present and geometrically plausible, otherwise the result says "not localized". OpenCV.js was intentionally not added, since it would not make landmark-based localization more reliable here and adds about 8 MB.

**Experimental strip.** The Results screen can show an unwrapped (polar) strip of the estimated iris annulus for visualization. It uses a fixed pupil fraction, no eyelid/eyelash/reflection masking and no feature extraction. It is not a biometric template and cannot be used for matching.

## Manual test checklist

Run with a real camera on each target. Tick each item.

**Browsers/devices**
- [ ] Chrome on macOS (and/or Windows) at `http://localhost:5173` and on the deployed HTTPS URL
- [ ] Safari on iPhone (deployed HTTPS URL; allow camera when prompted)
- [ ] Chrome on Android (deployed HTTPS URL)

**Permissions**
- [ ] Permission granted: scan proceeds through all states
- [ ] Permission denied: the camera screen shows the "permission was denied" help and a working Retry after you re-allow access
- [ ] No camera / camera covered or disabled: friendly error, no crash
- [ ] Camera in use by another app (for example a video call): "already in use" message

**Camera behavior**
- [ ] Switch camera (phone with front and back cameras, or a laptop with an external webcam): preview changes, only one camera light is on
- [ ] Rotate phone between portrait and landscape: preview fits the screen, overlay stays aligned
- [ ] Stop Camera: light goes off immediately, state shows "stopped", Retry works
- [ ] Cancel Scan: returns home, camera off
- [ ] Switch tabs or lock the phone during a scan: scan stops, camera released, message explains why
- [ ] Unplug a USB webcam mid-scan: "camera interrupted" error

**Scan quality**
- [ ] Good lighting, face centered, one blink: scan completes, blink count 1, crop shown
- [ ] Poor lighting (dim room or strong backlight): fails with a lighting message, no crop shown
- [ ] No face in frame (point the camera away): guidance "Center your face", times out safely
- [ ] Two faces in frame: asked to scan one person at a time
- [ ] Too far away: "Move closer" guidance
- [ ] Looking away: "Look toward the camera"
- [ ] Moving your head: "Hold still"
- [ ] Never blink for 15 s: "No blink detected in time" failure
- [ ] Glasses with glare: note whether blinks are still detected

**Repeat and cleanup**
- [ ] Scan Again several times without reloading: each scan works, counts reset
- [ ] Return Home clears the result; Settings > Clear temporary scan data works
- [ ] Browser devtools > Application: no localStorage/IndexedDB entries from the app
- [ ] Network tab during a scan: only the one-time WASM and model downloads, no image uploads

## Known limitations

- Verified by the author: the pure logic units (blink detector, state machine, image-quality metrics, landmark/EAR geometry, camera controller with mocked APIs). Not verified by the author: behavior on real cameras, real browsers, iOS Safari, performance, and the exact pinned dependency set. Run `npm install` and `npm run check` yourself.
- Pinned dependency versions are chosen to be mutually compatible, but `package-lock.json` is generated by your first `npm install`. Commit it after that.
- Thresholds (blink, gaze, eye size, sharpness) are generic starting points and will need tuning per camera and person.
- Blink detection is not liveness detection and can be fooled by video, and can miss blinks with heavy glare, thick frames or ptosis.
- Iris localization is landmark-based and approximate. There is no pupil/iris segmentation, no eyelid masking, and no template or matching.
- Without NIR illumination, iris texture in RGB images is limited and strongly affected by reflections and compression.
- First scan needs internet for model files unless you self-host them. Offline operation is untested.
- Safari/iOS: if autoplay of the preview is refused, tap the page and retry. Background tabs suspend the camera by design.
