import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    // GitHub project pages serve from /<repo>/; a custom domain serves from /. Set VITE_BASE_PATH accordingly.
    base: env.VITE_BASE_PATH || '/',
    plugins: [vue(), tailwindcss()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      // Mock mode loads the Apps Script sources from ../apps-script/src (outside the Vite root).
      fs: { allow: ['..'] },
    },
    // Pre-bundle the query library so the dev server never discovers it at runtime and force-reloads the page
    // (a reload drops the in-memory query cache, which the e2e cache test checks).
    optimizeDeps: { include: ['@tanstack/vue-query'] },
    build: {
      outDir: 'dist',
      sourcemap: false,
      target: 'es2020',
    },
  }
})
