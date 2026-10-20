import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api, ApiError } from '@/services/api'
import type { LoginResponse, User } from '@/types/api'

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
    session.value = { token: res.token, user: res.user, expiresAt: Date.now() + res.expiresInSeconds * 1000 - 60_000 }
    persist()
    return res.user
  }

  /** Re-validates the stored session with the backend (role/active status may have changed). */
  async function refresh(): Promise<boolean> {
    if (!session.value) return false
    verifying.value = true
    try {
      const me = await api.call<User>('auth.me')
      session.value = { ...session.value, user: me }
      persist()
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

  function clear() {
    session.value = null
    persist()
  }

  return { session, user, token, role, isAuthenticated, isCongregationUser, verifying, can, canAny, loginWithIdToken, refresh, logout, clear }
})
