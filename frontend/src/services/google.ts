/**
 * Google Identity Services (GIS) loader. Only the public OAuth client ID is used here; no secrets.
 * https://developers.google.com/identity/gsi/web
 */

interface GoogleAccountsId {
  initialize(config: {
    client_id: string
    callback: (response: { credential: string; select_by?: string }) => void
    auto_select?: boolean
    cancel_on_tap_outside?: boolean
    ux_mode?: 'popup' | 'redirect'
    use_fedcm_for_prompt?: boolean
    itp_support?: boolean
  }): void
  renderButton(parent: HTMLElement, options: Record<string, unknown>): void
  disableAutoSelect(): void
  prompt(): void
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleAccountsId } }
  }
}

let loading: Promise<GoogleAccountsId> | null = null

export function loadGoogleIdentity(): Promise<GoogleAccountsId> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id)
  if (loading) return loading
  loading = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.onload = () => {
      if (window.google?.accounts?.id) resolve(window.google.accounts.id)
      else reject(new Error('Google Identity Services failed to initialize.'))
    }
    script.onerror = () => { loading = null; reject(new Error('Could not load Google Sign-In. Check your connection or ad blocker.')) }
    document.head.appendChild(script)
  })
  return loading
}
