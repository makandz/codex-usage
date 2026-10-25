import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    modulePreload: false,
    cssCodeSplit: false,
    assetsInlineLimit: Infinity,
    rolldownOptions: { output: { codeSplitting: false } },
  },
});
