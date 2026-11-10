import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3300',
      '/uploads': 'http://localhost:3300',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
