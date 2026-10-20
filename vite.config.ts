import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Relative base so the production build works from any static host path
// (domain root or a sub-path such as https://user.github.io/irisblink/).
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    // `npm run dev:host` adds --host so a phone on the same Wi-Fi can reach the dev server.
  },
  build: {
    target: 'es2022',
    sourcemap: false,
  },
  test: {
    environment: 'node',
    include: ['src/tests/**/*.test.ts'],
  },
});
