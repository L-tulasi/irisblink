// Optional helper: self-host the MediaPipe WASM runtime and the face-landmarker model.
// Run once with internet access:  npm run vendor:mediapipe
import { cp, mkdir, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wasmSrc = path.join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const wasmDest = path.join(root, 'public', 'mediapipe', 'wasm');
const modelDest = path.join(root, 'public', 'models', 'face_landmarker.task');
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

try {
  await access(wasmSrc);
} catch {
  console.error('Could not find node_modules/@mediapipe/tasks-vision/wasm. Run `npm install` first.');
  process.exit(1);
}

await mkdir(wasmDest, { recursive: true });
await cp(wasmSrc, wasmDest, { recursive: true });
console.log('Copied WASM runtime to', path.relative(root, wasmDest));

await mkdir(path.dirname(modelDest), { recursive: true });
const res = await fetch(MODEL_URL);
if (!res.ok) {
  console.error(`Model download failed: HTTP ${res.status}`);
  process.exit(1);
}
await writeFile(modelDest, Buffer.from(await res.arrayBuffer()));
console.log('Saved model to', path.relative(root, modelDest));
console.log('\nNow add to .env.local:\n  VITE_MEDIAPIPE_WASM_URL=./mediapipe/wasm\n  VITE_FACE_MODEL_URL=./models/face_landmarker.task');
