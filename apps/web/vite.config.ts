import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { serviceWorker } from './build/serviceWorker.ts';

export default defineConfig({
  plugins: [react(), tailwindcss(), serviceWorker()],
});
