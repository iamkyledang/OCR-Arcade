import path from "path"
import { readFileSync } from "fs"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
// import { viteSingleFile } from "vite-plugin-singlefile"

export default defineConfig({
  base: '/OCR-Arcade/',
  plugins: [
    react(),
    // viteSingleFile(),
    // Dev-only: serve ort-wasm-simd-threaded.jsep.mjs directly from node_modules
    // before Vite's transformMiddleware intercepts it and returns 500 (static file can't be a module).
    // In production, the file is copied from public/ to dist/ normally.
    {
      name: 'serve-ort-jsep',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const url = (req.url ?? '').split('?')[0];
          if (url.endsWith('ort-wasm-simd-threaded.jsep.mjs')) {
            const filePath = path.resolve('./node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs');
            const content = readFileSync(filePath);
            res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache');
            res.end(content);
            return;
          }
          next();
        });
      }
    },
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    assetsInlineLimit: 100000000,
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
  optimizeDeps: {
    exclude: ['onnxruntime-web'],
    entries: ['index.html'],
  },
  server: {
    headers: {
      // Cross-Origin Isolation headers for ONNX Runtime multi-threading
      // Required for SharedArrayBuffer support
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless', // Changed from require-corp for better compatibility
    },
  },
})
