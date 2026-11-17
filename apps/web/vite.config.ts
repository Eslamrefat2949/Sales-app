import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// `--mode artifact` builds a self-contained demo (relative paths, no preload helper) that
// scripts/build-artifact.mjs folds into a single HTML file for sharing a link.
export default defineConfig(({ mode }) => {
  const artifact = mode === 'artifact';
  return {
    plugins: [react(), tailwindcss()],
    base: artifact ? './' : '/',
    build: artifact
      ? { outDir: 'dist-artifact', modulePreload: false, cssCodeSplit: false, assetsInlineLimit: 100_000_000 }
      : { outDir: 'dist' },
  };
});
