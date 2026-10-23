import { describe, expect, it } from 'vitest'
import { createHarness, seedScenario, type Harness } from './harness'

const SAMPLE = `Packing List  3770278
30 - g26.1-E | English - Awake!
150 - g26.1-TG | Tagalog - Awake!
2 - ldstd-2-E | Literature Display Stand - Double-sided`

function parse(h: Harness, text: string) {
  return h.rt.exports.parsePackingLists(text) as { lists: any[]; unparsed: any[] }
}

function snapshot(h: Harness) {
  return JSON.stringify(h.rt.snapshot().sheets)
}

describe('packing list parser', () => {
  it('parses the sample: number, quantity, symbol, language and title', () => {
    const h = createHarness()
    const { lists, unparsed } = parse(h, SAMPLE)
    expect(unparsed).toEqual([])
    expect(lists).toHaveLength(1)
    expect(lists[0].number).toBe('3770278')
    expect(lists[0].lines.map((l: any) => [l.quantity, l.symbol, l.language, l.title])).toEqual([
      [30, 'g26.1-E', 'English', 'Awake!'],
      [150, 'g26.1-TG', 'Tagalog', 'Awake!'],
      [2, 'ldstd-2-E', 'English', 'Literature Display Stand - Double-sided'],
    ])
  })

  it('keeps " - " inside a title when the segment is not a language, and takes the language from the symbol suffix', () => {
    const h = createHarness()
    const { lists } = parse(h, 'Packing List 1000001\n2 - ldstd-2-E | Literature Display Stand - Double-sided')
    expect(lists[0].lines[0]).toMatchObject({ title: 'Literature Display Stand - Double-sided', language: 'English' })
  })

  it('wraps a title from the next line, including a language-only first line', () => {
    const h = createHarness()
    const { lists } = parse(h, `Packing List 1000002
400 - T-fam-TG | Tagalog
Was Life Created?
10 - g26.1-E | English - Awake!
Large Print`)
    expect(lists[0].lines[0]).toMatchObject({ quantity: 400, symbol: 'T-fam-TG', language: 'Tagalog', title: 'Was Life Created?' })
    expect(lists[0].lines[1]).toMatchObject({ quantity: 10, symbol: 'g26.1-E', language: 'English', title: 'Awake! Large Print' })
  })

  it('handles several lists, mixed separators, Windows line endings, repeated symbols and bad lines', () => {
    const h = createHarness()
    const text = 'stray line\r\nPacking List No. 2000001\r\n5 - w26.03-E - English - The Watchtower\r\n5 - w26.03-E | English | The Watchtower\r\n0 - g26.1-E | English - Awake!\r\nPacking List #2000002\r\nabc - g26.1-E | English\r\n7 - bhs-TG | Tagalog | What Can the Bible Teach Us?'
    const { lists, unparsed } = parse(h, text)
    expect(unparsed).toHaveLength(1)
    expect(unparsed[0].text).toBe('stray line')
    expect(lists.map((l) => l.number)).toEqual(['2000001', '2000002'])
    expect(lists[0].lines).toHaveLength(1)
    expect(lists[0].lines[0]).toMatchObject({ quantity: 10, symbol: 'w26.03-E', title: 'The Watchtower' })
    expect(lists[0].notes[0]).toMatch(/more than once/)
    expect(lists[0].unparsed[0].reason).toMatch(/positive whole number/)
    expect(lists[1].unparsed[0].text).toBe('abc - g26.1-E | English')
    expect(lists[1].lines[0]).toMatchObject({ symbol: 'bhs-TG', language: 'Tagalog', title: 'What Can the Bible Teach Us?' })
  })

  it('assigns categories by title keywords first, then exact symbol patterns, else Book', () => {
    const h = createHarness()
    const cat = (symbol: string, title: string) => h.rt.exports.packingCategory(symbol, title) as string
    expect(cat('g26.1-TG', 'Awake!')).toBe('Awake')
    expect(cat('w26.03-E', 'The Watchtower')).toBe('Watchtower')
    expect(cat('wp26.1-E', '')).toBe('Watchtower')
    expect(cat('wlp26.1-TG', '')).toBe('Watchtower')
    expect(cat('g26.1-E', '')).toBe('Awake')
    expect(cat('mwb26.01-TG', 'Our Christian Life and Ministry')).toBe('Meeting Workbook')
    expect(cat('vol25-E', 'Bound Volume 2025')).toBe('Bound Volume')
    expect(cat('T-fam-TG', 'Was Life Created?')).toBe('Tract')
    expect(cat('jwcd-E', 'Contact Card')).toBe('Contact card')
    expect(cat('ldstd-2-E', 'Literature Display Stand - Double-sided')).toBe('Equipment')
    expect(cat('wcglp-TG', 'What Can the Bible Teach Us?')).toBe('Book') // not ^w\d
    expect(cat('bhs-TG', 'Bible Teach')).toBe('Book')
    expect(cat('wcglp-TG', 'The Watchtower Study Edition')).toBe('Watchtower') // title wins
  })
})

describe('deliveries.importPackingLists', () => {
  it('dry run reports matches, creations and problems and writes nothing', () => {
    const h = createHarness()
    const { manager } = seedScenario(h)
    h.ok('items.create', { sku: 'g26.1-tg', name: 'Awake! (Tagalog)', unit: 'pcs' }, h.admin)
    const before = snapshot(h)
    const plan = h.ok<any>('deliveries.importPackingLists', { text: 'nonsense line\n' + SAMPLE + '\nPacking List 3770278\n1 - g26.1-E | English - Awake!' }, manager)
    expect(plan.apply).toBe(false)
    expect(plan.unparsed).toEqual([{ text: 'nonsense line', reason: expect.stringMatching(/before any/) }])
    expect(plan.lists).toHaveLength(2)
    const first = plan.lists[0]
    expect(first.status).toBe('ok')
    expect(first.lines.map((l: any) => l.action)).toEqual(['create', 'exists', 'create'])
    expect(first.lines[1].sku).toBe('g26.1-tg') // matched case-insensitively, keeps the catalogue's sku
    expect(first.lines[2]).toMatchObject({ category: 'Equipment', name: 'Literature Display Stand - Double-sided (English)' })
    expect(plan.lists[1].status).toBe('duplicate')
    expect(plan.lists[1].problem).toMatch(/more than once in this paste/)
    expect(snapshot(h)).toBe(before)
    expect(h.ok<any>('audit.list', { action: 'deliveries.importPackingLists' }, h.admin).total).toBe(0)
  })

  it('apply creates missing items (SKU case kept, minStock 0) and one pending delivery per list; confirming posts stock once', () => {
    const h = createHarness()
    const { manager } = seedScenario(h)
    const res = h.ok<any>('deliveries.importPackingLists', { text: SAMPLE, apply: true, deliveryDate: '2026-10-20' }, manager)
    expect(res.apply).toBe(true)
    expect(res.itemsCreated).toEqual(['g26.1-E', 'g26.1-TG', 'ldstd-2-E'])
    expect(res.deliveriesCreated).toHaveLength(1)
    const d = h.ok<any>('deliveries.get', { deliveryId: res.deliveriesCreated[0].deliveryId }, manager)
    expect(d).toMatchObject({ status: 'Pending', sourceType: 'supplier', sourceName: 'Branch Office', packingListNumber: '3770278', deliveryDate: '2026-10-20', receivedBy: 'Manager', totalQty: 182 })
    const item = h.ok<any>('items.list', { query: 'g26.1-TG' }, manager).rows.find((i: any) => i.sku === 'g26.1-TG')
    expect(item).toMatchObject({ name: 'Awake! (Tagalog)', category: 'Awake', minStock: 0, physicalQty: 0 })
    h.ok('deliveries.confirm', { deliveryId: d.deliveryId }, manager)
    expect(h.ok<any>('items.get', { itemId: item.itemId }, manager).physicalQty).toBe(150)
    const audits = h.ok<any>('audit.list', { pageSize: 100 }, h.admin).rows.map((r: any) => r.action)
    expect(audits).toEqual(expect.arrayContaining(['items.create', 'deliveries.create', 'deliveries.importPackingLists', 'deliveries.confirm']))
    // list search finds the packing list number
    expect(h.ok<any>('deliveries.list', { query: '3770278' }, manager).total).toBe(1)
  })

  it('refuses a packing list number that was already entered, and skips it only with skipProblems', () => {
    const h = createHarness()
    const { manager } = seedScenario(h)
    h.ok('deliveries.importPackingLists', { text: SAMPLE, apply: true }, manager)
    const again = h.call('deliveries.importPackingLists', { text: SAMPLE, apply: true }, manager)
    expect(again.success).toBe(false)
    expect(again.error?.code).toBe('VALIDATION_ERROR')
    expect(again.error?.message).toMatch(/already entered as delivery DLV-/)
    const mixed = SAMPLE + '\nPacking List 3770279\n12 - g26.1-E | English - Awake!'
    expect(h.call('deliveries.importPackingLists', { text: mixed, apply: true }, manager).success).toBe(false)
    const res = h.ok<any>('deliveries.importPackingLists', { text: mixed, apply: true, skipProblems: true }, manager)
    expect(res.deliveriesCreated.map((d: any) => d.number)).toEqual(['3770279'])
    expect(res.itemsCreated).toEqual([]) // g26.1-E already exists from the first import
    expect(res.lists[0].status).toBe('duplicate')
    // the manual delivery form is protected too
    expect(h.call('deliveries.create', { deliveryDate: '2026-10-21', sourceName: 'Depot', receivedBy: 'A', packingListNumber: '3770278', items: [{ itemId: res.lists[1].lines[0].itemId, quantity: 1 }] }, manager).error?.code).toBe('CONFLICT')
  })

  it('is idempotent per request id and forbidden for read-only and congregation users', () => {
    const h = createHarness()
    const { manager, viewer, west } = seedScenario(h)
    const rid = 'packing-replay-0001'
    const a = h.ok<any>('deliveries.importPackingLists', { text: SAMPLE, apply: true }, manager, rid)
    const b = h.ok<any>('deliveries.importPackingLists', { text: SAMPLE, apply: true }, manager, rid)
    expect(b.deliveriesCreated).toEqual(a.deliveriesCreated)
    expect(h.ok<any>('deliveries.list', { query: '3770278' }, manager).total).toBe(1)
    expect(h.call('deliveries.importPackingLists', { text: SAMPLE }, viewer).error?.code).toBe('FORBIDDEN')
    expect(h.call('deliveries.importPackingLists', { text: SAMPLE }, west).error?.code).toBe('FORBIDDEN')
  })

  it('an inactive catalogue item blocks the line until reactivated', () => {
    const h = createHarness()
    const { manager } = seedScenario(h)
    const created = h.ok<any>('items.create', { sku: 'g26.1-E', name: 'Awake! (English)', unit: 'pcs' }, h.admin)
    h.ok('items.update', { itemId: created.itemId, sku: 'g26.1-E', name: 'Awake! (English)', active: false }, h.admin)
    const plan = h.ok<any>('deliveries.importPackingLists', { text: SAMPLE }, manager)
    expect(plan.lists[0].status).toBe('problems')
    expect(plan.lists[0].unparsed[0].reason).toMatch(/inactive/)
  })
})

describe('item SKU case', () => {
  it('keeps the SKU as typed on create and update, with case-insensitive duplicate checks', () => {
    const h = createHarness()
    const created = h.ok<any>('items.create', { sku: 'g26.1-TG', name: 'Awake! (Tagalog)', unit: 'pcs' }, h.admin)
    expect(created.sku).toBe('g26.1-TG')
    expect(h.call('items.create', { sku: 'G26.1-tg', name: 'dup', unit: 'pcs' }, h.admin).error?.code).toBe('CONFLICT')
    const updated = h.ok<any>('items.update', { itemId: created.itemId, sku: 'g26.1-TG', name: 'Awake! (Tagalog) 2026' }, h.admin)
    expect(updated.sku).toBe('g26.1-TG')
  })
})
