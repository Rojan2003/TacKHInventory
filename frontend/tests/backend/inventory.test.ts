import { describe, expect, it } from 'vitest'
import { available, createHarness, physical, rid, seedScenario } from './harness'

function makeDelivery(h: ReturnType<typeof createHarness>, token: string, itemId: string, qty: number, extra: Record<string, unknown> = {}) {
  return h.ok<any>('deliveries.create', { deliveryDate: '2026-10-01', sourceType: 'supplier', sourceName: 'Branch Depot', receivedBy: 'Bro. A', items: [{ itemId, quantity: qty }], ...extra }, token)
}

describe('deliveries and the ledger', () => {
  it('pending deliveries do not change stock; confirmation increases stock exactly once', () => {
    const h = createHarness()
    const { manager, items } = seedScenario(h)
    const item = items[2] // Insight, 0 stock
    expect(physical(h, manager, item.itemId)).toBe(0)
    const d = makeDelivery(h, manager, item.itemId, 25)
    expect(d.status).toBe('Pending')
    expect(physical(h, manager, item.itemId)).toBe(0)

    const confirmed = h.ok<any>('deliveries.confirm', { deliveryId: d.deliveryId }, manager)
    expect(confirmed.status).toBe('Confirmed')
    expect(confirmed.ledgerPosted).toBe(true)
    expect(physical(h, manager, item.itemId)).toBe(25)

    // Retry with a brand-new requestId: status guard prevents a second posting
    const again = h.ok<any>('deliveries.confirm', { deliveryId: d.deliveryId }, manager)
    expect(again.status).toBe('Confirmed')
    expect(physical(h, manager, item.itemId)).toBe(25)
    const ledger = h.ok<any>('items.history', { itemId: item.itemId }, manager)
    expect(ledger.rows.filter((r: any) => r.refId === d.deliveryId)).toHaveLength(1)
  })

  it('a retried submission with the same requestId is served from the idempotency store', () => {
    const h = createHarness()
    const { manager, items } = seedScenario(h)
    const requestId = rid()
    const first = h.ok<any>('deliveries.create', { deliveryDate: '2026-10-02', sourceName: 'Depot', receivedBy: 'B', confirmNow: true, items: [{ itemId: items[2].itemId, quantity: 10 }] }, manager, requestId)
    const second = h.ok<any>('deliveries.create', { deliveryDate: '2026-10-02', sourceName: 'Depot', receivedBy: 'B', confirmNow: true, items: [{ itemId: items[2].itemId, quantity: 10 }] }, manager, requestId)
    expect(second.deliveryId).toBe(first.deliveryId)
    expect(physical(h, manager, items[2].itemId)).toBe(10)
    expect(h.ok<any>('deliveries.list', {}, manager).total).toBe(1)
  })

  it('cancelled deliveries never post, confirmed ones cannot be cancelled, and input is validated', () => {
    const h = createHarness()
    const { manager, items } = seedScenario(h)
    const d = makeDelivery(h, manager, items[2].itemId, 5)
    h.ok('deliveries.cancel', { deliveryId: d.deliveryId, reason: 'duplicate' }, manager)
    expect(h.call('deliveries.confirm', { deliveryId: d.deliveryId }, manager).error?.code).toBe('INVALID_TRANSITION')
    expect(physical(h, manager, items[2].itemId)).toBe(0)

    const d2 = makeDelivery(h, manager, items[2].itemId, 5, { confirmNow: true })
    expect(h.call('deliveries.cancel', { deliveryId: d2.deliveryId }, manager).error?.code).toBe('INVALID_TRANSITION')

    expect(h.call('deliveries.create', { deliveryDate: 'not-a-date', sourceName: 'X', receivedBy: 'Y', items: [{ itemId: items[0].itemId, quantity: 1 }] }, manager).error?.code).toBe('VALIDATION_ERROR')
    expect(h.call('deliveries.create', { deliveryDate: '2026-10-01', sourceName: 'X', receivedBy: 'Y', items: [{ itemId: items[0].itemId, quantity: -3 }] }, manager).error?.code).toBe('VALIDATION_ERROR')
    expect(h.call('deliveries.create', { deliveryDate: '2026-10-01', sourceName: 'X', receivedBy: 'Y', items: [{ itemId: items[0].itemId, quantity: 1.5 }] }, manager).error?.code).toBe('VALIDATION_ERROR')
    expect(h.call('deliveries.create', { deliveryDate: '2026-10-01', sourceName: 'X', receivedBy: 'Y', items: [] }, manager).error?.code).toBe('VALIDATION_ERROR')
    expect(h.call('deliveries.create', { deliveryDate: '2026-10-01', sourceName: 'X', receivedBy: 'Y', items: [{ itemId: 'nope', quantity: 1 }] }, manager).error?.code).toBe('NOT_FOUND')
  })

  it('stock adjustments cannot drive a balance negative', () => {
    const h = createHarness()
    const { manager, items } = seedScenario(h)
    expect(h.call('items.adjust', { itemId: items[1].itemId, quantity: -51, reason: 'count' }, manager).error?.code).toBe('INSUFFICIENT_STOCK')
    h.ok('items.adjust', { itemId: items[1].itemId, quantity: -50, reason: 'count' }, manager)
    expect(physical(h, manager, items[1].itemId)).toBe(0)
  })

  it('returns LOCKED (not a crash) when the script lock is busy, and a clean error when the spreadsheet is unavailable', () => {
    let busy = false
    const h = createHarness({ lockBusy: () => busy })
    const { manager, items } = seedScenario(h)
    busy = true
    const res = h.call('deliveries.create', { deliveryDate: '2026-10-01', sourceName: 'X', receivedBy: 'Y', items: [{ itemId: items[0].itemId, quantity: 1 }] }, manager)
    expect(res.error?.code).toBe('LOCKED')
    busy = false

    let down = false
    const h2 = createHarness({ spreadsheetUnavailable: () => down })
    down = true
    const res2 = h2.call('items.list', {}, h2.admin)
    expect(res2.success).toBe(false)
    expect(res2.error?.code).toBe('CONFIGURATION_ERROR')
    expect(JSON.stringify(res2)).not.toMatch(/at .*\.js:\d+/) // no stack traces
  })
})

describe('requests, reservations and distributions', () => {
  function approvedRequest(h: ReturnType<typeof createHarness>, s: ReturnType<typeof seedScenario>, lines: { itemId: string; quantity: number }[]) {
    const req = h.ok<any>('requests.create', { items: lines, submit: true, requestedBy: 'West Literature Overseer' }, s.west)
    expect(req.status).toBe('Pending')
    expect(req.congregationId).toBe(s.congs.WEST.congregationId) // forced to own congregation
    return h.ok<any>('requests.approve', { requestId: req.requestId }, s.manager)
  }

  it('congregation users can only create/see their own requests; approval reserves stock', () => {
    const h = createHarness()
    const s = seedScenario(h)
    const req = h.ok<any>('requests.create', { congregationId: s.congs.SLC.congregationId, items: [{ itemId: s.items[0].itemId, quantity: 10 }], submit: true }, s.west)
    expect(req.congregationId).toBe(s.congs.WEST.congregationId)
    expect(h.call('requests.get', { requestId: req.requestId }, s.slc).error?.code).toBe('FORBIDDEN')
    expect(h.ok<any>('requests.list', {}, s.slc).total).toBe(0)
    expect(h.ok<any>('requests.list', {}, s.west).total).toBe(1)

    expect(available(h, s.manager, s.items[0].itemId)).toBe(100)
    const approved = h.ok<any>('requests.approve', { requestId: req.requestId }, s.manager)
    expect(approved.status).toBe('Approved')
    const item = h.ok<any>('items.get', { itemId: s.items[0].itemId }, s.manager)
    expect(item.physicalQty).toBe(100)
    expect(item.reservedQty).toBe(10)
    expect(item.availableQty).toBe(90)
  })

  it('approvals are capped by available stock and by requested quantity; cancellation releases reservations', () => {
    const h = createHarness()
    const s = seedScenario(h)
    const big = h.ok<any>('requests.create', { items: [{ itemId: s.items[1].itemId, quantity: 60 }], submit: true }, s.west) // only 50 in stock
    expect(h.call('requests.approve', { requestId: big.requestId }, s.manager).error?.code).toBe('INSUFFICIENT_STOCK')
    const line = h.ok<any>('requests.get', { requestId: big.requestId }, s.manager).items[0]
    expect(h.call('requests.approve', { requestId: big.requestId, items: [{ requestItemId: line.requestItemId, approvedQty: 70 }] }, s.manager).error?.code).toBe('VALIDATION_ERROR')
    const partial = h.ok<any>('requests.approve', { requestId: big.requestId, items: [{ requestItemId: line.requestItemId, approvedQty: 40 }] }, s.manager)
    expect(partial.approvedTotal).toBe(40)
    expect(available(h, s.manager, s.items[1].itemId)).toBe(10)

    // a congregation user cannot cancel an approved request, the manager can
    expect(h.call('requests.cancel', { requestId: big.requestId }, s.west).error?.code).toBe('FORBIDDEN')
    const cancelled = h.ok<any>('requests.cancel', { requestId: big.requestId, reason: 'no longer needed' }, s.manager)
    expect(cancelled.status).toBe('Cancelled')
    expect(available(h, s.manager, s.items[1].itemId)).toBe(50)
    // terminal
    expect(h.call('requests.approve', { requestId: big.requestId }, s.manager).error?.code).toBe('INVALID_TRANSITION')
  })

  it('status transitions are enforced', () => {
    const h = createHarness()
    const s = seedScenario(h)
    const draft = h.ok<any>('requests.create', { items: [{ itemId: s.items[0].itemId, quantity: 1 }] }, s.west)
    expect(draft.status).toBe('Draft')
    expect(h.call('requests.approve', { requestId: draft.requestId }, s.manager).error?.code).toBe('INVALID_TRANSITION')
    expect(h.call('distributions.create', { requestId: draft.requestId, items: [{ itemId: s.items[0].itemId, quantity: 1 }] }, s.manager).error?.code).toBe('INVALID_TRANSITION')
    h.ok('requests.submit', { requestId: draft.requestId }, s.west)
    const rejected = h.ok<any>('requests.reject', { requestId: draft.requestId, decisionNotes: 'Out of scope' }, s.manager)
    expect(rejected.status).toBe('Rejected')
    expect(h.call('requests.submit', { requestId: draft.requestId }, s.west).error?.code).toBe('INVALID_TRANSITION')
  })

  it('distributions deduct stock exactly once, update fulfilment and status, and reject over-release', () => {
    const h = createHarness()
    const s = seedScenario(h)
    const req = approvedRequest(h, s, [{ itemId: s.items[0].itemId, quantity: 30 }, { itemId: s.items[1].itemId, quantity: 20 }])
    expect(available(h, s.manager, s.items[0].itemId)).toBe(70)

    // more than remaining on the request
    expect(h.call('distributions.create', { requestId: req.requestId, items: [{ itemId: s.items[0].itemId, quantity: 31 }] }, s.manager).error?.code).toBe('VALIDATION_ERROR')
    // item not on request
    expect(h.call('distributions.create', { requestId: req.requestId, items: [{ itemId: s.items[2].itemId, quantity: 1 }] }, s.manager).error?.code).toBe('VALIDATION_ERROR')

    const requestId = rid()
    const d1 = h.ok<any>('distributions.create', { requestId: req.requestId, items: [{ itemId: s.items[0].itemId, quantity: 10 }], releasedBy: 'Bro. R', receivedBy: 'Bro. W' }, s.manager, requestId)
    expect(d1.status).toBe('Released')
    expect(d1.reference).toMatch(/^DST-\d{4}-\d{4}$/)
    expect(d1.receipt.items[0].quantity).toBe(10)
    // duplicate submit (same requestId) -> same distribution, no second deduction
    const dup = h.ok<any>('distributions.create', { requestId: req.requestId, items: [{ itemId: s.items[0].itemId, quantity: 10 }] }, s.manager, requestId)
    expect(dup.distributionId).toBe(d1.distributionId)
    expect(physical(h, s.manager, s.items[0].itemId)).toBe(90)
    expect(h.ok<any>('distributions.list', {}, s.manager).total).toBe(1)

    let r = h.ok<any>('requests.get', { requestId: req.requestId }, s.manager)
    expect(r.status).toBe('Partially Fulfilled')
    expect(r.fulfilledTotal).toBe(10)
    expect(r.remainingTotal).toBe(40)
    // reservation shrinks as fulfilled: physical 90, reserved 20 -> available 70 (unchanged)
    expect(available(h, s.manager, s.items[0].itemId)).toBe(70)

    h.ok('distributions.create', { requestId: req.requestId, items: [{ itemId: s.items[0].itemId, quantity: 20 }, { itemId: s.items[1].itemId, quantity: 20 }] }, s.manager)
    r = h.ok<any>('requests.get', { requestId: req.requestId }, s.manager)
    expect(r.status).toBe('Fulfilled')
    expect(physical(h, s.manager, s.items[0].itemId)).toBe(70)
    expect(physical(h, s.manager, s.items[1].itemId)).toBe(30)
    expect(h.call('distributions.create', { requestId: req.requestId, items: [{ itemId: s.items[0].itemId, quantity: 1 }] }, s.manager).error?.code).toBe('INVALID_TRANSITION')
  })

  it('never lets reservations or releases exceed physical stock, even across requests', () => {
    const h = createHarness()
    const s = seedScenario(h)
    // 50 Watchtower in stock. West gets 30 approved, SLC asks for 30 -> only 20 available
    approvedRequest(h, s, [{ itemId: s.items[1].itemId, quantity: 30 }])
    const slcReq = h.ok<any>('requests.create', { items: [{ itemId: s.items[1].itemId, quantity: 30 }], submit: true }, s.slc)
    expect(h.call('requests.approve', { requestId: slcReq.requestId }, s.manager).error?.code).toBe('INSUFFICIENT_STOCK')
    const line = h.ok<any>('requests.get', { requestId: slcReq.requestId }, s.manager).items[0]
    h.ok('requests.approve', { requestId: slcReq.requestId, items: [{ requestItemId: line.requestItemId, approvedQty: 20 }] }, s.manager)
    expect(available(h, s.manager, s.items[1].itemId)).toBe(0)
    // physical drops to 0 after both are fully released; a third ad-hoc release is impossible
    const westReq = h.ok<any>('requests.list', { congregationId: s.congs.WEST.congregationId }, s.manager).rows[0]
    h.ok('distributions.create', { requestId: westReq.requestId, items: [{ itemId: s.items[1].itemId, quantity: 30 }] }, s.manager)
    h.ok('distributions.create', { requestId: slcReq.requestId, items: [{ itemId: s.items[1].itemId, quantity: 20 }] }, s.manager)
    expect(physical(h, s.manager, s.items[1].itemId)).toBe(0)
    h.ok('settings.update', { key: 'allowAdHocDistribution', value: 'true' }, h.admin)
    expect(h.call('distributions.create', { destinationCongregationId: s.congs.SLC.congregationId, items: [{ itemId: s.items[1].itemId, quantity: 1 }] }, s.manager).error?.code).toBe('INSUFFICIENT_STOCK')
  })

  it('congregation users confirm receipt only for their own congregation', () => {
    const h = createHarness()
    const s = seedScenario(h)
    const req = approvedRequest(h, s, [{ itemId: s.items[0].itemId, quantity: 5 }])
    const d = h.ok<any>('distributions.create', { requestId: req.requestId, items: [{ itemId: s.items[0].itemId, quantity: 5 }] }, s.manager)
    expect(h.call('distributions.confirmReceipt', { distributionId: d.distributionId }, s.slc).error?.code).toBe('FORBIDDEN')
    expect(h.call('distributions.get', { distributionId: d.distributionId }, s.slc).error?.code).toBe('FORBIDDEN')
    const confirmed = h.ok<any>('distributions.confirmReceipt', { distributionId: d.distributionId, receivedBy: 'Bro. West' }, s.west)
    expect(confirmed.status).toBe('Received')
    expect(confirmed.receivedConfirmedBy).toBe('west@example.com')
    // stock overview for West shows received, not physical
    const overview = h.ok<any>('stock.overview', {}, s.west)
    expect(overview.isCoordinator).toBe(false)
    expect(overview.totals.receivedQty).toBe(5)
    expect(overview.items[0].receivedQty).toBe(5)
    expect(h.call('stock.overview', { congregationId: s.congs.SLC.congregationId }, s.west).error?.code).toBe('FORBIDDEN')
  })

  it('with reserveOnApproval off, approvals do not reduce available stock', () => {
    const h = createHarness()
    const s = seedScenario(h)
    h.ok('settings.update', { key: 'reserveOnApproval', value: 'false' }, h.admin)
    approvedRequest(h, s, [{ itemId: s.items[0].itemId, quantity: 30 }])
    const item = h.ok<any>('items.get', { itemId: s.items[0].itemId }, s.manager)
    expect(item.reservedQty).toBe(0)
    expect(item.availableQty).toBe(100)
  })
})

describe('reports, dashboard and reconciliation', () => {
  it('reports reconcile with the ledger and do not double count across congregations', () => {
    const h = createHarness()
    const s = seedScenario(h)
    makeDelivery(h, s.manager, s.items[2].itemId, 40, { confirmNow: true })
    const req = h.ok<any>('requests.create', { items: [{ itemId: s.items[0].itemId, quantity: 25 }], submit: true }, s.west)
    h.ok('requests.approve', { requestId: req.requestId }, s.manager)
    const d = h.ok<any>('distributions.create', { requestId: req.requestId, items: [{ itemId: s.items[0].itemId, quantity: 25 }] }, s.manager)
    h.ok('distributions.confirmReceipt', { distributionId: d.distributionId }, s.west)

    const inv = h.ok<any>('reports.run', { type: 'inventory' }, s.manager)
    const ledger = h.ok<any>('reports.run', { type: 'transactions' }, s.manager)
    const ledgerTotal = ledger.rows.reduce((sum: number, r: any) => sum + r.quantity, 0)
    const invTotal = inv.rows.reduce((sum: number, r: any) => sum + r.physicalQty, 0)
    expect(invTotal).toBe(ledgerTotal)
    expect(invTotal).toBe(100 + 50 + 40 - 25)

    const summary = h.ok<any>('reports.run', { type: 'congregationSummary' }, s.manager)
    const east = summary.rows.find((r: any) => r.role.startsWith('Coordinator'))
    const west = summary.rows.find((r: any) => r.congregation === 'West Congregation')
    expect(east.physicalQty).toBe(165)
    expect(west.receivedQty).toBe(25)
    expect(west.releasedQty).toBe(25)
    // East physical + everything released == total ever received into the system
    const releasedAll = summary.rows.filter((r: any) => r.role === 'Member').reduce((sum: number, r: any) => sum + r.releasedQty, 0)
    expect(east.physicalQty + releasedAll).toBe(190)

    const monthly = h.ok<any>('reports.run', { type: 'monthly' }, s.manager)
    expect(monthly.rows.reduce((sum: number, r: any) => sum + r.netChange, 0)).toBe(165)

    const dash = h.ok<any>('dashboard.summary', {}, s.manager)
    expect(dash.stock.physicalQty).toBe(165)
    expect(dash.stock.uniqueItems).toBe(3)
    expect(dash.requests.fulfilled).toBe(1)
    expect(dash.distributions.received).toBe(1)
    expect(dash.distributionByCongregation.find((c: any) => c.name === 'West Congregation').receivedQty).toBe(25)
    expect(dash.recentTransactions.length).toBeGreaterThan(0)

    const low = h.ok<any>('reports.run', { type: 'lowStock' }, s.manager)
    expect(low.rows.map((r: any) => r.sku)).toEqual([]) // all above minStock 5

    // congregation user dashboard is scoped and hides East totals
    const westDash = h.ok<any>('dashboard.summary', { congregationId: s.congs.SLC.congregationId }, s.west)
    expect(westDash.stock.physicalQty).toBeNull()
    expect(westDash.congregationId).toBe(s.congs.WEST.congregationId)
  })

  it('legacy worksheets stay readable and are never written', () => {
    const h = createHarness()
    const s = seedScenario(h)
    const before = JSON.stringify(h.rt.sheets.get('East_Inventory')!.data)
    const legacy = h.ok<any>('reports.run', { type: 'legacyEastInventory', from: '2026-06-01', to: '2026-06-30' }, s.manager)
    expect(legacy.rows).toHaveLength(3)
    expect(legacy.columns.map((c: any) => c.key)).toEqual(['Literature Code', 'Literature Name', 'Total', 'Date'])
    const dry = h.ok<any>('admin.importLegacyOpeningBalances', {}, h.admin)
    expect(dry.apply).toBe(false)
    expect(dry.month).toBe('2026-06')
    expect(dry.planned).toHaveLength(3)
    expect(physical(h, h.admin, s.items[0].itemId)).toBe(100)
    const applied = h.ok<any>('admin.importLegacyOpeningBalances', { apply: true }, h.admin)
    expect(applied.planned).toHaveLength(3)
    expect(physical(h, h.admin, s.items[0].itemId)).toBe(112)
    expect(h.call('admin.importLegacyOpeningBalances', { apply: true }, h.admin).error?.code).toBe('CONFLICT')
    expect(JSON.stringify(h.rt.sheets.get('East_Inventory')!.data)).toBe(before)
    expect(JSON.stringify(h.rt.sheets.get('Distribution')!.data)).toContain('LIT001')
  })

  it('reconcile repairs a drifted balance and finalizes an interrupted distribution', () => {
    const h = createHarness()
    const s = seedScenario(h)
    // Corrupt the cached balance directly in the sheet
    const balances = h.rt.sheets.get('InventoryBalances')!
    const headers = balances.data[0] as string[]
    const qtyCol = headers.indexOf('physicalQty')
    const row = balances.data.findIndex((r, i) => i > 0 && r[0] === s.items[0].itemId)
    balances.data[row][qtyCol] = 999
    expect(physical(h, s.manager, s.items[0].itemId)).toBe(999)
    const dry = h.ok<any>('admin.reconcile', {}, h.admin)
    expect(dry.applied).toBe(false)
    expect(dry.balanceFixes).toEqual([{ itemId: s.items[0].itemId, cached: 999, ledger: 100 }])
    expect(physical(h, s.manager, s.items[0].itemId)).toBe(999)
    const applied = h.ok<any>('admin.reconcile', { apply: true }, h.admin)
    expect(applied.applied).toBe(true)
    expect(physical(h, s.manager, s.items[0].itemId)).toBe(100)

    // Simulate a distribution whose run died after the ledger write but before finalization
    const req = h.ok<any>('requests.create', { items: [{ itemId: s.items[0].itemId, quantity: 5 }], submit: true }, s.west)
    h.ok('requests.approve', { requestId: req.requestId }, s.manager)
    const d = h.ok<any>('distributions.create', { requestId: req.requestId, items: [{ itemId: s.items[0].itemId, quantity: 5 }] }, s.manager)
    const dist = h.rt.sheets.get('Distributions')!
    const dh = dist.data[0] as string[]
    const drow = dist.data.findIndex((r, i) => i > 0 && r[dh.indexOf('distributionId')] === d.distributionId)
    dist.data[drow][dh.indexOf('status')] = 'Processing'
    const fix = h.ok<any>('admin.reconcile', { apply: true }, h.admin)
    expect(fix.processingDistributions).toEqual([expect.objectContaining({ distributionId: d.distributionId, ledgerWritten: true, action: 'finalize' })])
    expect(h.ok<any>('distributions.get', { distributionId: d.distributionId }, s.manager).status).toBe('Released')
    expect(h.ok<any>('requests.get', { requestId: req.requestId }, s.manager).status).toBe('Fulfilled')
  })

  it('audit log records who did what', () => {
    const h = createHarness()
    const s = seedScenario(h)
    makeDelivery(h, s.manager, s.items[2].itemId, 3, { confirmNow: true })
    const audit = h.ok<any>('audit.list', { action: 'deliveries.' }, h.admin)
    expect(audit.rows.map((r: any) => r.action).sort()).toEqual(['deliveries.confirm', 'deliveries.create'])
    expect(audit.rows[0].actor).toBe('manager@example.com')
  })
})
