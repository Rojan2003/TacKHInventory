/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "http" (real Apps Script backend) or "mock" (in-browser fake runtime). */
  readonly VITE_API_MODE?: 'http' | 'mock'
  /** Apps Script web app URL ending in /exec. Public by design; it is not a secret. */
  readonly VITE_API_BASE_URL?: string
  /** Google OAuth 2.0 Web client ID. Public by design; it is not a secret. */
  readonly VITE_GOOGLE_CLIENT_ID?: string
  readonly VITE_BASE_PATH?: string
  readonly VITE_APP_NAME?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}
