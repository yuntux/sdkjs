import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    wasm()
  ],
  build: {
    // On veut générer une librairie (un fichier unique injectable)
    lib: {
      entry: resolve(__dirname, 'src/Injector.ts'),
      name: 'LoroSyncInjector',
      fileName: 'injector.bundle',
      formats: ['iife'], // IIFE pour être facilement injectable via une balise <script>
    },
    rollupOptions: {
      // S'il y a des dépendances qu'on ne veut pas bundler, c'est ici
    }
  }
});
