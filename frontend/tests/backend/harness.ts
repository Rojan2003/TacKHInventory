import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createGasRuntime, LEGACY_SHEETS_SAMPLE, type ApiEnvelope, type GasRuntime, type GasRuntimeOptions } from '../../src/mock/gasRuntime'

/** Override with APPS_SCRIPT_SRC to test a different source directory (e.g. a folder holding the Code.gs bundle). */
export const APPS_SCRIPT_SRC = process.env.APPS_SCRIPT_SRC || resolve(__dirname, '../../../apps-script/src')

export function loadBackendSources(): string[] {
  return readdirSync(APPS_SCRIPT_SRC)
    .filter((f) => f.endsWith('.js'))
    .sort()
    .map((f) => readFileSync(join(APPS_SCRIPT_SRC, f), 'utf8'))
}

export const ADMIN_EMAIL = 'congregationliterature@gmail.com'

let counter = 0
export function rid(): string {
  counter += 1
  return `test-req-${Date.now()}-${counter}-${Math.random().toString(16).slice(2, 8)}`
}

export interface Harness {
  rt: GasRuntime
  /** Calls an action as the given session token (or anonymously). */
  call<T = any>(action: string, params?: Record<string, unknown>, token?: string | null, requestId?: string): ApiEnvelope<T>
  /** Calls and asserts success; returns data. */
  ok<T = any>(action: string, params?: Record<string, unknown>, token?: string | null, requestId?: string): T
  login(email: string, name?: string): { token: string; user: any }
  admin: string
}

export function createHarness(overrides: Partial<GasRuntimeOptions> = {}): Harness {
  const rt = createGasRuntime({ sources: loadBackendSources(), initialSheets: LEGACY_SHEETS_SAMPLE, ...overrides })
  rt.setup()
  const call = <T,>(action: string, params: Record<string, unknown> = {}, token: string | null = null, requestId?: string) =>
    rt.handleRequest<T>({ action, params, token: token || undefined, requestId: requestId || rid() })
  const ok = <T,>(action: string, params: Record<string, unknown> = {}, token: string | null = null, requestId?: string): T => {
    const res = call<T>(action, params, token, requestId)
    if (!res.success) throw new Error(`${action} failed: ${res.error?.code} ${res.error?.message}`)
    return res.data
  }
  const login = (email: string, name?: string) => {
    const data = ok<{ token: string; user: any }>('auth.login', { idToken: `mock:${email}${name ? ':' + name : ''}` })
    return data
  }
  const admin = login(ADMIN_EMAIL, 'Admin').token
  return { rt, call, ok, login, admin }
}

/** Seeds a typical environment: items, users of each role. Returns tokens and ids. */
export function seedScenario(h: Harness) {
  const congs = h.ok<any[]>('congregations.list', {}, h.admin)
  const byCode = Object.fromEntries(congs.map((c) => [c.code, c]))
  const items = [
    h.ok<any>('items.create', { sku: 'LIT001', name: 'Awake', unit: 'pcs', minStock: 5, openingQty: 100 }, h.admin),
    h.ok<any>('items.create', { sku: 'LIT002', name: 'Watchtower', unit: 'pcs', minStock: 5, openingQty: 50 }, h.admin),
    h.ok<any>('items.create', { sku: 'LIT003', name: 'Insight', unit: 'pcs', minStock: 5 }, h.admin),
  ]
  h.ok('users.create', { email: 'manager@example.com', name: 'Manager', role: 'literature_servant' }, h.admin)
  h.ok('users.create', { email: 'west@example.com', name: 'West User', role: 'congregation_user', congregationId: byCode.WEST.congregationId }, h.admin)
  h.ok('users.create', { email: 'slc@example.com', name: 'SLC User', role: 'congregation_user', congregationId: byCode.SLC.congregationId }, h.admin)
  h.ok('users.create', { email: 'viewer@example.com', name: 'Viewer', role: 'read_only' }, h.admin)
  const manager = h.login('manager@example.com').token
  const west = h.login('west@example.com').token
  const slc = h.login('slc@example.com').token
  const viewer = h.login('viewer@example.com').token
  return { congs: byCode, items, manager, west, slc, viewer }
}

export function physical(h: Harness, token: string, itemId: string): number {
  return h.ok<any>('items.get', { itemId }, token).physicalQty
}
export function available(h: Harness, token: string, itemId: string): number {
  return h.ok<any>('items.get', { itemId }, token).availableQty
}
