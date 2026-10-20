# Optional self-hosted model

By default the app downloads `face_landmarker.task` from Google's model storage at scan time.

To self-host it, run `npm run vendor:mediapipe` from the project root (needs internet once). It places
`face_landmarker.task` here and copies the MediaPipe WASM runtime to `public/mediapipe/wasm`.
Then set `VITE_FACE_MODEL_URL` and `VITE_MEDIAPIPE_WASM_URL` in `.env.local` (see `.env.example`).

The model file is not committed to this project.
