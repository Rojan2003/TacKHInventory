/**
 * Backend read cache (CacheService) and the app.bootstrap action.
 * The fake CacheService never expires entries, so TTL behaviour is documented rather than tested here.
 */
import { describe, expect, it } from 'vitest'
import { createHarness, seedScenario, type Harness } from './harness'

const ITEMS_SHEET = 'LiteratureItems'
const BALANCES_SHEET = 'InventoryBalances'

function cacheKeys(h: Harness, sheet?: string) {
  return [...h.rt.cache.keys()].filter((k) => k.startsWith('rows:') && (!sheet || k.endsWith(':' + sheet)))
}

/** Simulates a human editing a cell directly in Google Sheets (no backend call, no version bump). */
function editSheetCell(h: Harness, sheet: string, idColumn: string, id: string, column: string, value: unknown) {
  const s = h.rt.sheets.get(sheet)!
  const headers = s.data[0].map(String)
  const idx = headers.indexOf(column)
  const row = s.data.findIndex((r, i) => i > 0 && String(r[headers.indexOf(idColumn)]) === id)
  expect(row, `${sheet} row ${id}`).toBeGreaterThan(0)
  s.data[row][idx] = value
}

function itemNamed(h: Harness, token: string, sku: string) {
  return h.ok<any>('items.list', { query: sku }, token).rows.find((r: any) => r.sku === sku)
}

describe('backend read cache', () => {
  it('serves cached rows outside the lock and drops them after any mutation', () => {
    const h = createHarness()
    const { items } = seedScenario(h)
    expect(itemNamed(h, h.admin, 'LIT001').name).toBe('Awake')
    expect(cacheKeys(h, ITEMS_SHEET)).toHaveLength(1)
    const versionBefore = h.rt.cache.get('dataVersion')
    editSheetCell(h, ITEMS_SHEET, 'itemId', items[0].itemId, 'name', 'Awake (edited by hand)')
    expect(itemNamed(h, h.admin, 'LIT001').name).toBe('Awake') // still the cached copy
    h.ok('items.update', { itemId: items[1].itemId, sku: 'LIT002', name: 'Watchtower 2' }, h.admin) // unrelated mutation
    expect(h.rt.cache.get('dataVersion')).not.toBe(versionBefore)
    expect(itemNamed(h, h.admin, 'LIT001').name).toBe('Awake (edited by hand)')
  })

  it('reads inside the lock bypass the cache and never populate it', () => {
    const h = createHarness()
    const { items } = seedScenario(h)
    expect(itemNamed(h, h.admin, 'LIT001').physicalQty).toBe(100)
    expect(cacheKeys(h, BALANCES_SHEET)).toHaveLength(1)
    // A hand edit lowers the balance to 70 while the cache still says 100.
    editSheetCell(h, BALANCES_SHEET, 'itemId', items[0].itemId, 'physicalQty', 70)
    expect(itemNamed(h, h.admin, 'LIT001').physicalQty).toBe(100)
    const keysBefore = cacheKeys(h, BALANCES_SHEET)
    const adjusted = h.ok<any>('items.adjust', { itemId: items[0].itemId, quantity: 5, reason: 'count' }, h.admin)
    // 75 proves the mutation read the sheet (70 + 5), not the cached 100.
    expect(adjusted.physicalQty).toBe(75)
    // the reads inside the lock wrote nothing to the cache: no new balance entry appeared during the mutation
    expect(cacheKeys(h, BALANCES_SHEET)).toEqual(keysBefore)
    expect(itemNamed(h, h.admin, 'LIT001').physicalQty).toBe(75)
    const versionNow = h.rt.cache.get('dataVersion')
    expect(cacheKeys(h, BALANCES_SHEET)).toContain(`rows:${versionNow}:${BALANCES_SHEET}`)
  })

  it('a mutation that fails partway still invalidates the cache (version bumped in finally)', () => {
    const h = createHarness()
    const { items } = seedScenario(h)
    expect(itemNamed(h, h.admin, 'LIT001').physicalQty).toBe(100)
    const versionBefore = h.rt.cache.get('dataVersion')
    editSheetCell(h, BALANCES_SHEET, 'itemId', items[0].itemId, 'physicalQty', 70)
    const failed = h.call('items.adjust', { itemId: items[0].itemId, quantity: -500, reason: 'too much' }, h.admin)
    expect(failed.success).toBe(false)
    expect(failed.error?.code).toBe('INSUFFICIENT_STOCK')
    expect(h.rt.cache.get('dataVersion')).not.toBe(versionBefore)
    expect(itemNamed(h, h.admin, 'LIT001').physicalQty).toBe(70)
  })

  it('a missing or evicted version key produces a new version, never an old one', () => {
    const h = createHarness()
    const { items } = seedScenario(h)
    expect(itemNamed(h, h.admin, 'LIT001').name).toBe('Awake')
    const old = h.rt.cache.get('dataVersion')!
    editSheetCell(h, ITEMS_SHEET, 'itemId', items[0].itemId, 'name', 'Awake (edited by hand)')
    h.rt.cache.delete('dataVersion') // eviction
    expect(itemNamed(h, h.admin, 'LIT001').name).toBe('Awake (edited by hand)')
    const fresh = h.rt.cache.get('dataVersion')!
    expect(fresh).toBeTruthy()
    expect(fresh).not.toBe(old)
    expect(h.rt.cache.has(`rows:${old}:${ITEMS_SHEET}`)).toBe(true) // orphaned, unreachable
  })

  it('CACHE_ENABLED=false switches the cache off', () => {
    const h = createHarness({ initialProperties: { CACHE_ENABLED: 'false' } })
    const { items } = seedScenario(h)
    expect(itemNamed(h, h.admin, 'LIT001').name).toBe('Awake')
    expect(cacheKeys(h)).toHaveLength(0)
    editSheetCell(h, ITEMS_SHEET, 'itemId', items[0].itemId, 'name', 'Awake (edited by hand)')
    expect(itemNamed(h, h.admin, 'LIT001').name).toBe('Awake (edited by hand)')
    expect(h.ok<any>('admin.clearCache', {}, h.admin).cacheEnabled).toBe(false)
  })

  it('never caches per-account, audit or idempotency sheets', () => {
    const h = createHarness()
    seedScenario(h)
    h.ok('users.list', {}, h.admin)
    h.ok('audit.list', {}, h.admin)
    h.ok('auth.me', {}, h.admin)
    expect(cacheKeys(h, 'AuthorizedUsers')).toHaveLength(0)
    expect(cacheKeys(h, 'AuditLogs')).toHaveLength(0)
    expect(cacheKeys(h, 'IdempotencyKeys')).toHaveLength(0)
  })

  it('skips sheets whose rows exceed the CacheService value limit', () => {
    const h = createHarness()
    const { items } = seedScenario(h)
    const s = h.rt.sheets.get('InventoryTransactions')!
    const headers = s.data[0].map(String)
    const filler = 'x'.repeat(200)
    for (let i = 0; i < 600; i++) {
      const row = headers.map(() => '')
      row[headers.indexOf('txnId')] = `txn_big${i}`
      row[headers.indexOf('timestamp')] = '2026-01-01T00:00:00.000Z'
      row[headers.indexOf('type')] = 'ADJUSTMENT'
      row[headers.indexOf('itemId')] = items[2].itemId
      row[headers.indexOf('quantity')] = '0'
      row[headers.indexOf('notes')] = filler
      s.data.push(row)
    }
    const history = h.ok<any>('items.history', { itemId: items[2].itemId, pageSize: 5 }, h.admin)
    expect(history.total).toBeGreaterThanOrEqual(600)
    expect(cacheKeys(h, 'InventoryTransactions')).toHaveLength(0)
    expect(cacheKeys(h, ITEMS_SHEET).length).toBeGreaterThan(0) // small sheets are still cached
  })

  it('admin.clearCache is admin-only, bumps the version and is audited', () => {
    const h = createHarness()
    const { items, manager, viewer } = seedScenario(h)
    expect(h.call('admin.clearCache', {}, viewer).error?.code).toBe('FORBIDDEN')
    expect(h.call('admin.clearCache', {}, manager).error?.code).toBe('FORBIDDEN')
    expect(itemNamed(h, h.admin, 'LIT001').name).toBe('Awake')
    editSheetCell(h, ITEMS_SHEET, 'itemId', items[0].itemId, 'name', 'Awake (edited by hand)')
    const before = h.rt.cache.get('dataVersion')
    const res = h.ok<any>('admin.clearCache', {}, h.admin)
    expect(res.dataVersion).not.toBe(before)
    expect(res.cacheEnabled).toBe(true)
    expect(itemNamed(h, h.admin, 'LIT001').name).toBe('Awake (edited by hand)')
    const audit = h.ok<any>('audit.list', { action: 'admin.clearCache' }, h.admin)
    expect(audit.total).toBe(1)
  })

  it('every mutating action family invalidates cached rows', () => {
    const h = createHarness()
    const { items, congs, manager, west } = seedScenario(h)
    const mutations: Array<[string, Record<string, unknown>, string]> = [
      ['deliveries.create', { deliveryDate: '2026-10-01', sourceName: 'Depot', receivedBy: 'A', confirmNow: true, items: [{ itemId: items[0].itemId, quantity: 1 }] }, manager],
      ['requests.create', { submit: true, items: [{ itemId: items[0].itemId, quantity: 1 }] }, west],
      ['congregations.save', { code: 'NEW', name: 'New Cong' }, h.admin],
      ['settings.update', { key: 'defaultLowStockThreshold', value: '7' }, h.admin],
      ['items.create', { sku: 'LIT900', name: 'New', unit: 'pcs' }, h.admin],
    ]
    for (const [action, params, token] of mutations) {
      h.ok('items.list', {}, h.admin)
      h.ok('congregations.list', {}, h.admin)
      const before = h.rt.cache.get('dataVersion')
      const keysBefore = cacheKeys(h)
      expect(keysBefore.length, action).toBeGreaterThan(0)
      h.ok(action, params, token)
      const after = h.rt.cache.get('dataVersion')
      expect(after, action).not.toBe(before)
      cacheKeys(h).forEach((k) => { if (k.includes(`:${after}:`)) expect(keysBefore).not.toContain(k) })
    }
    expect(congs.WEST).toBeTruthy()
  })
})

describe('app.bootstrap', () => {
  it('returns the user, congregations and settings in one call', () => {
    const h = createHarness()
    const { west } = seedScenario(h)
    const admin = h.ok<any>('app.bootstrap', {}, h.admin)
    expect(admin.user.role).toBe('admin')
    expect(admin.congregations.length).toBe(5)
    expect(admin.settings.some((s: any) => s.key === 'reserveOnApproval')).toBe(true)
    expect(admin.build).toBe('dev')
    h.ok('congregations.save', { congregationId: admin.congregations.find((c: any) => c.code === 'CENTRAL').congregationId, active: false, code: 'CENTRAL', name: 'Central Congregation' }, h.admin)
    expect(h.ok<any>('app.bootstrap', {}, h.admin).congregations.length).toBe(5) // admins see inactive ones too
    expect(h.ok<any>('app.bootstrap', {}, west).congregations.length).toBe(4)   // others only active
    expect(h.call('app.bootstrap', {}, null).error?.code).toBe('UNAUTHENTICATED')
  })
})
