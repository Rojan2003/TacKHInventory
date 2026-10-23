import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api, ApiError } from '@/services/api'
import { clearQueryCache, enablePersistence } from '@/services/queryClient'
import { useReferenceStore } from '@/stores/reference'
import type { BootstrapResponse, LoginResponse, User } from '@/types/api'

const STORAGE_KEY = 'ecli.session.v1'

interface StoredSession { token: string; user: User; expiresAt: number }

function readSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as StoredSession
    if (!s.token || !s.user || !s.expiresAt || s.expiresAt < Date.now()) return null
    return s
  } catch {
    return null
  }
}

export const useAuthStore = defineStore('auth', () => {
  const session = ref<StoredSession | null>(readSession())
  const verifying = ref(false)
  // Restore this user's cached pages (sessionStorage) so the first paint after a reload is instant.
  if (session.value) enablePersistence(session.value.user.userId)

  const user = computed(() => session.value?.user ?? null)
  const token = computed(() => session.value?.token ?? null)
  const isAuthenticated = computed(() => !!session.value)
  const role = computed(() => user.value?.role ?? null)
  const isCongregationUser = computed(() => role.value === 'congregation_user')

  function can(permission: string): boolean {
    return !!user.value && user.value.permissions.includes(permission)
  }
  function canAny(permissions: string[]): boolean {
    return permissions.some((p) => can(p))
  }

  function persist() {
    try {
      if (session.value) localStorage.setItem(STORAGE_KEY, JSON.stringify(session.value))
      else localStorage.removeItem(STORAGE_KEY)
    } catch { /* ignore */ }
  }

  async function loginWithIdToken(idToken: string): Promise<User> {
    const res = await api.call<LoginResponse>('auth.login', { idToken }, { token: null })
    clearQueryCache() // never show a previous account's pages
    session.value = { token: res.token, user: res.user, expiresAt: Date.now() + res.expiresInSeconds * 1000 - 60_000 }
    persist()
    enablePersistence(res.user.userId)
    return res.user
  }

  /**
   * Re-validates the stored session with the backend (role/active status may have changed) and, in the same
   * round trip, loads the congregations and settings the app needs (app.bootstrap).
   */
  async function refresh(): Promise<boolean> {
    if (!session.value) return false
    verifying.value = true
    try {
      const boot = await api.call<BootstrapResponse>('app.bootstrap')
      session.value = { ...session.value, user: boot.user }
      persist()
      useReferenceStore().applyBootstrap(boot)
      return true
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'UNAUTHENTICATED' || err.code === 'UNAUTHORIZED')) {
        clear()
        return false
      }
      return true // network hiccup: keep the session, pages will show their own errors
    } finally {
      verifying.value = false
    }
  }

  async function logout() {
    try { if (session.value) await api.call('auth.logout') } catch { /* ignore */ }
    clear()
  }

  /** Drops the session and every cached page (memory and sessionStorage). Also used on 401 / expiry. */
  function clear() {
    session.value = null
    persist()
    clearQueryCache()
  }

  return { session, user, token, role, isAuthenticated, isCongregationUser, verifying, can, canAny, loginWithIdToken, refresh, logout, clear }
})
