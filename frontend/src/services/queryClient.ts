/**
 * Client-side read cache (TanStack Query) with stale-while-revalidate, mutation-driven invalidation and
 * per-user sessionStorage persistence for the data families that are safe to keep between page loads.
 *
 * Rules
 * - Query keys are [action, params]. The "family" of a key is the action prefix before the dot.
 * - A successful mutation invalidates the families listed in INVALIDATION for its own family.
 * - Only PERSISTED_FAMILIES are written to sessionStorage; users, audit and settings never are.
 * - clearQueryCache() wipes memory and storage; the auth store calls it on logout and on session expiry / 401.
 */
import { QueryClient } from '@tanstack/vue-query'

export const STALE_MS = 30_000
export const PERSISTED_FAMILIES = ['items', 'stock', 'dashboard', 'congregations', 'deliveries', 'requests', 'distributions'] as const
const STORAGE_PREFIX = 'ecli.qc.v1.'
const STORAGE_VERSION = 1

/** Which cached families a successful mutation of a given family makes stale. '*' means everything. */
export const INVALIDATION: Record<string, string[]> = {
  items: ['items', 'dashboard', 'stock', 'reports'],
  deliveries: ['deliveries', 'items', 'dashboard', 'stock', 'reports'],
  requests: ['requests', 'items', 'dashboard', 'stock', 'reports', 'distributions'],
  distributions: ['distributions', 'requests', 'items', 'dashboard', 'stock', 'reports'],
  congregations: ['congregations', 'app', 'stock', 'dashboard', 'requests', 'distributions', 'deliveries', 'users'],
  settings: ['settings', 'app', 'items', 'dashboard', 'stock', 'requests'],
  users: ['users', 'audit'],
  admin: ['*'],
  auth: [],
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: STALE_MS,
      gcTime: 30 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
  },
})

export function familyOf(actionOrKey: string | readonly unknown[]): string {
  const action = Array.isArray(actionOrKey) ? String(actionOrKey[0]) : String(actionOrKey)
  return action.split('.')[0]
}

/** Read actions never trigger invalidation. */
export function isReadAction(action: string): boolean {
  return /\.(list|get|history|summary|overview|run|me|bootstrap)$/.test(action) || action === 'health'
}

export function familiesInvalidatedBy(action: string): string[] {
  if (isReadAction(action)) return []
  const fam = familyOf(action)
  return INVALIDATION[fam] ?? ['*']
}

export function invalidateAfter(action: string): void {
  const fams = familiesInvalidatedBy(action)
  if (!fams.length) return
  if (fams.includes('*')) { void queryClient.invalidateQueries(); return }
  void queryClient.invalidateQueries({ predicate: (q) => fams.includes(familyOf(q.queryKey)) })
}

/* ---------- Persistence ---------- */

interface PersistedEntry { key: readonly unknown[]; data: unknown; updatedAt: number }

let persistKey: string | null = null
let unsubscribe: (() => void) | null = null
let flushTimer: ReturnType<typeof setTimeout> | null = null

export function isPersistable(key: readonly unknown[]): boolean {
  return (PERSISTED_FAMILIES as readonly string[]).includes(familyOf(key))
}

function flush() {
  if (!persistKey) return
  const entries: PersistedEntry[] = queryClient.getQueryCache().getAll()
    .filter((q) => q.state.status === 'success' && q.state.data !== undefined && isPersistable(q.queryKey))
    .map((q) => ({ key: q.queryKey, data: q.state.data, updatedAt: q.state.dataUpdatedAt }))
  try { sessionStorage.setItem(persistKey, JSON.stringify({ v: STORAGE_VERSION, entries })) } catch { /* storage unavailable or full */ }
}

function scheduleFlush() {
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(flush, 400)
}

function hydrate(key: string): number {
  let count = 0
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return 0
    const parsed = JSON.parse(raw) as { v: number; entries: PersistedEntry[] }
    if (parsed.v !== STORAGE_VERSION || !Array.isArray(parsed.entries)) return 0
    for (const e of parsed.entries) {
      if (!Array.isArray(e.key) || !isPersistable(e.key)) continue
      queryClient.setQueryData(e.key, e.data, { updatedAt: e.updatedAt })
      count += 1
    }
  } catch { /* ignore corrupt storage */ }
  return count
}

function removeStoredCaches() {
  try {
    Object.keys(sessionStorage).filter((k) => k.startsWith(STORAGE_PREFIX)).forEach((k) => sessionStorage.removeItem(k))
  } catch { /* ignore */ }
}

/** Starts persisting for this user and restores what that user had before. Call after sign-in or on app start. */
export function enablePersistence(userId: string): number {
  stopPersistence()
  persistKey = STORAGE_PREFIX + userId
  const restored = hydrate(persistKey)
  unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (event.type === 'added' || event.type === 'updated' || event.type === 'removed') scheduleFlush()
  })
  return restored
}

function stopPersistence() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null }
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
  persistKey = null
}

/** Wipes memory and storage. Used on logout and whenever the session is rejected or expires. */
export function clearQueryCache(): void {
  stopPersistence()
  removeStoredCaches()
  queryClient.clear()
}
