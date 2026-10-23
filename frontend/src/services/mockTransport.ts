/**
 * Browser mock transport (VITE_API_MODE=mock).
 * Runs the real Apps Script backend inside the browser against an in-memory spreadsheet that is persisted
 * to localStorage, so the whole UI can be exercised end to end without a Google deployment.
 * Sign-in uses "mock:<email>" tokens instead of Google Identity Services.
 */
import { createGasRuntime, LEGACY_SHEETS_SAMPLE, type GasRuntime, type RuntimeSnapshot } from '@/mock/gasRuntime'
import type { ApiEnvelope, RequestEnvelope } from '@/types/api'
import type { Transport } from './api'

const STORAGE_KEY = 'ecli.mock.db.v4' // bumped whenever the seed changes so browsers pick up the new demo data

const sourceModules = import.meta.glob('../../../apps-script/src/*.js', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

export const MOCK_ACCOUNTS = [
  { email: 'congregationliterature@gmail.com', name: 'Initial Administrator', role: 'admin' },
  { email: 'manager@example.com', name: 'Congregation Literature Servant', role: 'literature_servant' },
  { email: 'west@example.com', name: 'West Literature Overseer', role: 'congregation_user' },
  { email: 'slc@example.com', name: 'SLC Literature Overseer', role: 'congregation_user' },
  { email: 'central@example.com', name: 'Central Literature Overseer', role: 'congregation_user' },
  { email: 'tagalog@example.com', name: 'Tagalog Literature Overseer', role: 'congregation_user' },
  { email: 'viewer@example.com', name: 'Read-Only Viewer', role: 'read_only' },
  { email: 'stranger@example.com', name: 'Unauthorized Account', role: '(not authorized)' },
]

function loadSnapshot(): RuntimeSnapshot | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as RuntimeSnapshot) : null
  } catch {
    return null
  }
}

function saveSnapshot(rt: GasRuntime) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rt.snapshot()))
  } catch {
    /* storage may be unavailable; mock keeps working in memory */
  }
}

function seedDemoData(rt: GasRuntime) {
  const rid = () => 'seed-' + Math.random().toString(16).slice(2)
  const call = <T,>(action: string, params: Record<string, unknown>, token?: string): T => {
    const res = rt.handleRequest<T>({ action, params, token, requestId: rid() })
    if (!res.success) throw new Error(`${action}: ${res.error?.message}`)
    return res.data
  }
  const admin = call<{ token: string }>('auth.login', { idToken: 'mock:congregationliterature@gmail.com:Initial Administrator' }).token
  const congs = call<{ code: string; congregationId: string }[]>('congregations.list', {}, admin)
  const byCode = Object.fromEntries(congs.map((c) => [c.code, c.congregationId]))
  call('users.create', { email: 'manager@example.com', name: 'Congregation Literature Servant', role: 'literature_servant' }, admin)
  call('users.create', { email: 'west@example.com', name: 'West Literature Overseer', role: 'congregation_user', congregationId: byCode.WEST }, admin)
  call('users.create', { email: 'slc@example.com', name: 'SLC Literature Overseer', role: 'congregation_user', congregationId: byCode.SLC }, admin)
  call('users.create', { email: 'central@example.com', name: 'Central Literature Overseer', role: 'congregation_user', congregationId: byCode.CENTRAL }, admin)
  call('users.create', { email: 'tagalog@example.com', name: 'Tagalog Literature Overseer', role: 'congregation_user', congregationId: byCode.TAGALOG }, admin)
  call('users.create', { email: 'viewer@example.com', name: 'Read-Only Viewer', role: 'read_only' }, admin)
  const items = [
    ['LIT001', 'Awake!', 'Magazines', 120],
    ['LIT002', 'The Watchtower', 'Magazines', 85],
    ['LIT003', 'Insight on the Scriptures', 'Books', 6],
    ['LIT004', 'The Watchtower (Study Edition)', 'Magazines', 40],
    ['LIT005', 'Enjoy Life Forever!', 'Books', 32],
    ['LIT006', 'Bible Teach', 'Books', 0],
  ] as const
  const created = items.map(([sku, name, category, qty]) => call<{ itemId: string }>('items.create', { sku, name, category, unit: 'pcs', minStock: 10, openingQty: qty }, admin))
  const manager = call<{ token: string }>('auth.login', { idToken: 'mock:manager@example.com:Congregation Literature Servant' }).token
  call('deliveries.create', { deliveryDate: new Date().toISOString().slice(0, 10), sourceType: 'supplier', sourceName: 'Branch Office', receivedBy: 'Congregation Literature Servant', confirmNow: true, items: [{ itemId: created[2].itemId, quantity: 20 }, { itemId: created[5].itemId, quantity: 15 }] }, manager)
  call('deliveries.create', { deliveryDate: new Date().toISOString().slice(0, 10), sourceType: 'supplier', sourceName: 'Branch Office', receivedBy: 'Congregation Literature Servant', items: [{ itemId: created[0].itemId, quantity: 50 }] }, manager)
  const west = call<{ token: string }>('auth.login', { idToken: 'mock:west@example.com:West Literature Overseer' }).token
  const req = call<{ requestId: string }>('requests.create', { submit: true, requestedBy: 'West Literature Overseer', items: [{ itemId: created[0].itemId, quantity: 30 }, { itemId: created[1].itemId, quantity: 20 }] }, west)
  call('requests.approve', { requestId: req.requestId }, manager)
  call('distributions.create', { requestId: req.requestId, releasedBy: 'Congregation Literature Servant', receivedBy: 'West Literature Overseer', items: [{ itemId: created[0].itemId, quantity: 30 }] }, manager)
  const slc = call<{ token: string }>('auth.login', { idToken: 'mock:slc@example.com:SLC Literature Overseer' }).token
  call('requests.create', { submit: true, requestedBy: 'SLC Literature Overseer', items: [{ itemId: created[4].itemId, quantity: 10 }] }, slc)
}

let runtime: GasRuntime | null = null

export function getMockRuntime(): GasRuntime {
  if (runtime) return runtime
  const sources = Object.keys(sourceModules).sort().map((k) => sourceModules[k])
  runtime = createGasRuntime({ sources, initialSheets: LEGACY_SHEETS_SAMPLE })
  const snap = loadSnapshot()
  if (snap) {
    runtime.load(snap)
  } else {
    runtime.setup()
    seedDemoData(runtime)
    saveSnapshot(runtime)
  }
  return runtime
}

export function resetMockData() {
  localStorage.removeItem(STORAGE_KEY)
  runtime = null
  getMockRuntime()
}

export class MockTransport implements Transport {
  async send<T>(body: RequestEnvelope): Promise<ApiEnvelope<T>> {
    const rt = getMockRuntime()
    await new Promise((r) => setTimeout(r, 120 + Math.random() * 200)) // simulate latency
    const res = rt.handleRequest<T>(body)
    if (body.action !== 'auth.me' && !body.action.endsWith('.list') && !body.action.endsWith('.get')) saveSnapshot(rt)
    return res
  }
}
