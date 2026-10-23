import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearQueryCache, enablePersistence, familiesInvalidatedBy, invalidateAfter, isPersistable, isReadAction, queryClient } from '@/services/queryClient'

const STORAGE = 'ecli.qc.v1.user-1'

beforeEach(() => {
  vi.useFakeTimers()
  sessionStorage.clear()
  clearQueryCache()
})
afterEach(() => { vi.useRealTimers() })

describe('mutation → cache invalidation mapping', () => {
  it('read actions never invalidate; mutations invalidate their related families', () => {
    expect(familiesInvalidatedBy('items.list')).toEqual([])
    expect(familiesInvalidatedBy('app.bootstrap')).toEqual([])
    expect(familiesInvalidatedBy('dashboard.summary')).toEqual([])
    expect(familiesInvalidatedBy('deliveries.confirm')).toEqual(expect.arrayContaining(['deliveries', 'items', 'dashboard', 'stock']))
    expect(familiesInvalidatedBy('requests.approve')).toEqual(expect.arrayContaining(['requests', 'items', 'distributions']))
    expect(familiesInvalidatedBy('users.update')).toEqual(['users', 'audit'])
    expect(familiesInvalidatedBy('admin.clearCache')).toEqual(['*'])
    expect(familiesInvalidatedBy('something.new')).toEqual(['*']) // unknown families invalidate everything, never nothing
    expect(isReadAction('auth.logout')).toBe(false)
  })

  it('marks only the related queries stale', () => {
    queryClient.setQueryData(['items.list', {}], { rows: [] })
    queryClient.setQueryData(['users.list', {}], { rows: [] })
    queryClient.setQueryData(['dashboard.summary', {}], { ok: true })
    invalidateAfter('deliveries.confirm')
    expect(queryClient.getQueryState(['items.list', {}])?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(['dashboard.summary', {}])?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(['users.list', {}])?.isInvalidated).toBe(false)
    invalidateAfter('items.list') // a read changes nothing
    expect(queryClient.getQueryState(['users.list', {}])?.isInvalidated).toBe(false)
  })
})

describe('sessionStorage persistence', () => {
  it('persists only the allowed families, per user', () => {
    expect(isPersistable(['items.list', {}])).toBe(true)
    expect(isPersistable(['stock.overview', {}])).toBe(true)
    expect(isPersistable(['users.list', {}])).toBe(false)
    expect(isPersistable(['audit.list', {}])).toBe(false)
    expect(isPersistable(['settings.get', {}])).toBe(false)
    expect(isPersistable(['app.bootstrap', {}])).toBe(false)

    enablePersistence('user-1')
    queryClient.setQueryData(['items.list', { page: 1 }], { rows: [{ sku: 'LIT001' }] })
    queryClient.setQueryData(['users.list', {}], { rows: [{ email: 'secret@example.com' }] })
    queryClient.setQueryData(['settings.get', {}], [{ key: 'x' }])
    vi.advanceTimersByTime(1000)
    const raw = sessionStorage.getItem(STORAGE)!
    expect(raw).toContain('LIT001')
    expect(raw).not.toContain('secret@example.com')
    expect(raw).not.toContain('settings.get')
  })

  it('restores persisted pages for the same user with their original timestamp', () => {
    enablePersistence('user-1')
    queryClient.setQueryData(['dashboard.summary', {}], { stock: 1 }, { updatedAt: 1_000_000 })
    vi.advanceTimersByTime(1000)
    queryClient.clear() // simulate a page reload: memory is gone, storage remains
    expect(queryClient.getQueryData(['dashboard.summary', {}])).toBeUndefined()
    const restored = enablePersistence('user-1')
    expect(restored).toBe(1)
    expect(queryClient.getQueryData(['dashboard.summary', {}])).toEqual({ stock: 1 })
    expect(queryClient.getQueryState(['dashboard.summary', {}])?.dataUpdatedAt).toBe(1_000_000)
    // a different user never sees it
    queryClient.clear()
    expect(enablePersistence('user-2')).toBe(0)
  })

  it('clearQueryCache wipes memory and storage (logout, 401, expiry)', () => {
    enablePersistence('user-1')
    queryClient.setQueryData(['items.list', {}], { rows: [1] })
    vi.advanceTimersByTime(1000)
    expect(sessionStorage.getItem(STORAGE)).toBeTruthy()
    clearQueryCache()
    expect(sessionStorage.getItem(STORAGE)).toBeNull()
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
    // after clearing, nothing is persisted any more until a user signs in again
    queryClient.setQueryData(['items.list', {}], { rows: [2] })
    vi.advanceTimersByTime(1000)
    expect(sessionStorage.getItem(STORAGE)).toBeNull()
  })
})
