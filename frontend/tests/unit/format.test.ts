import { describe, expect, it, vi } from 'vitest'
import { downloadCsv, formatNumber, signed, toIsoDateOrEmpty } from './helpers'

describe('format helpers', () => {
  it('formats numbers and signed deltas', () => {
    expect(formatNumber(1234)).toBe((1234).toLocaleString())
    expect(formatNumber(null)).toBe('—')
    expect(signed(5)).toBe('+5')
    expect(signed(-5)).toBe('-5')
  })

  it('neutralises spreadsheet formulas in CSV exports and quotes values', () => {
    const blobs: string[] = []
    vi.stubGlobal('URL', { createObjectURL: (b: Blob) => { blobs.push(b as unknown as string); return 'blob:x' }, revokeObjectURL: () => undefined })
    const click = vi.fn()
    const origCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => { const el = origCreate(tag); if (tag === 'a') (el as HTMLAnchorElement).click = click; return el })
    downloadCsv('test', [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }], [{ a: '=HYPERLINK("x")', b: 'He said "hi"' }, { a: 12, b: '' }])
    expect(click).toHaveBeenCalledOnce()
    expect(blobs).toHaveLength(1)
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('iso date helper tolerates empty input', () => {
    expect(toIsoDateOrEmpty('')).toBe('')
    expect(toIsoDateOrEmpty('2026-10-20T10:00:00Z')).toBe('2026-10-20')
  })
})
