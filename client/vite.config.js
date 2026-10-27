import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Express API (and its SEO routes) served by the backend.
const API_TARGET = process.env.API_TARGET || 'http://localhost:5000';
const proxy = Object.fromEntries(['/api', '/uploads', '/sitemap.xml', '/robots.txt'].map((p) => [p, { target: API_TARGET, changeOrigin: true }]));

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy },
  preview: { port: 4173, proxy },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom', 'react-helmet-async'],
          map: ['leaflet', 'react-leaflet'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    css: false,
  },
});
