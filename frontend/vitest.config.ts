import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    // the fake Apps Script runtime reads ../apps-script/src
    fs: { allow: ['..'] },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
    globals: false,
    // Unit tests never use the in-browser mock transport; backend tests load the runtime explicitly.
    env: { VITE_API_MODE: 'http', VITE_API_BASE_URL: 'https://example.invalid/exec', VITE_GOOGLE_CLIENT_ID: 'test-client' },
  },
})
