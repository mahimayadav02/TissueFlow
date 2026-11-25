import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // With VITE_USE_SERVER=1 the website calls /api/v1/… on its own address; while developing, those calls
    // are passed on to the backend running on this computer (npm run dev in backend/).
    proxy: { '/api': { target: process.env.API_TARGET ?? 'http://localhost:4000' } },
  },
});
