import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// `ISOLATE=1 npm run preview` mimics the desktop app, which sends these headers so onnxruntime can use threads
const isolated = process.env.ISOLATE
  ? { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' }
  : undefined

export default defineConfig({
  plugins: [react()],
  base: './',
  clearScreen: false,
  // the worker lazy-loads one of two onnxruntime builds, which needs an ES-module worker
  worker: { format: 'es' },
  server: { strictPort: true },
  preview: { headers: isolated },
})
