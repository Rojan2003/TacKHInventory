import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { router } from '@/router'
import { useAuthStore } from '@/stores/auth'
import type { User } from '@/types/api'

function fakeUser(role: User['role'], permissions: string[]): User {
  return { userId: 'u', email: 'a@b.co', name: 'A', role, congregationId: '', congregationName: '', congregationCode: '', active: true, lastLoginAt: '', permissions }
}

describe('route guards (UX layer; the backend enforces permissions again)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('redirects anonymous users to the login page with a redirect target', async () => {
    await router.push('/inventory')
    await router.isReady()
    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query.redirect).toBe('/inventory')
  })

  it('sends users without the permission to the forbidden page', async () => {
    const auth = useAuthStore()
    auth.session = { token: 't', user: fakeUser('read_only', ['items.view', 'dashboard.view']), expiresAt: Date.now() + 60_000 }
    await router.push('/admin')
    expect(router.currentRoute.value.name).toBe('forbidden')
    await router.push('/inventory')
    expect(router.currentRoute.value.name).toBe('inventory')
  })

  it('keeps signed-in users away from the login page', async () => {
    const auth = useAuthStore()
    auth.session = { token: 't', user: fakeUser('admin', ['dashboard.view']), expiresAt: Date.now() + 60_000 }
    await router.push('/login')
    expect(router.currentRoute.value.name).toBe('dashboard')
  })
})
