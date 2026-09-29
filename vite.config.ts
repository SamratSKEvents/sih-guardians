import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The site's base path: '/' locally, '/<repo>/' on GitHub Pages (set by the deploy workflow).
const base = process.env.BASE ?? '/';

export default defineConfig({
  base,
  plugins: [react()],
  // The prototype is static; Vite only serves the bundled frontend and assets.
  server: { port: 5199, strictPort: true },
  preview: { port: 5199, strictPort: true },
  define: {
    CESIUM_BASE_URL: JSON.stringify(`${base}cesium`),
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
    // Pre-bundle everything up front: a dep found late (lucide-react in the
    // lazy Dashboard) re-optimises mid-session and leaves two React copies.
    include: ['cesium', 'react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'lucide-react', 'leaflet', 'driver.js'],
  },
});
