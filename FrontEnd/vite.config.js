import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: '.',
  base: './',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        pasajero: resolve(__dirname, 'pasajero.html'),
        conductor: resolve(__dirname, 'conductor.html'),
        login: resolve(__dirname, 'login.html'),
        registro: resolve(__dirname, 'registro.html'),
        admin: resolve(__dirname, 'admin.html')
      }
    }
  },
  server: {
    port: 5173,
    open: false
  }
});
