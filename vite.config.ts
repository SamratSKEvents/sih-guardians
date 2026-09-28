import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // The prototype is static; Vite only serves the bundled frontend and assets.
  server: { port: 5199, strictPort: true },
  preview: { port: 5199, strictPort: true },
  define: {
    CESIUM_BASE_URL: JSON.stringify('/cesium'),
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        // Only Cesium's own files: the object form also pulled shared helpers
        // in, which made the landing page download Cesium.
        // Vite's preload helper gets its own tiny chunk: left alone it lands in
        // Cesium's (Cesium uses dynamic imports too), and the landing page then
        // downloads all of Cesium just to import the helper.
        manualChunks: (id) =>
          id.includes('vite/preload-helper') ? 'preload' : /[\/]node_modules[\/]@?cesium/.test(id) ? 'cesium' : undefined,
      },
    },
  },
  optimizeDeps: {
    include: ['cesium'],
  },
});
