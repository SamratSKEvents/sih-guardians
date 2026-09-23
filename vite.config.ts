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
        manualChunks: {
          cesium: ['cesium'],
        },
      },
    },
  },
  optimizeDeps: {
    include: ['cesium'],
  },
});
