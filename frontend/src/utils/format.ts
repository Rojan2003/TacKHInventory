export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value.length === 10 ? value + 'T00:00:00' : value)
  if (isNaN(d.getTime())) return value
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  if (isNaN(d.getTime())) return value
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function formatNumber(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  const n = Number(value)
  if (isNaN(n)) return String(value)
  return n.toLocaleString()
}

export function signed(value: number): string {
  return value > 0 ? `+${formatNumber(value)}` : formatNumber(value)
}

export function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function monthStartIso(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`
}

export const TXN_TYPE_LABELS: Record<string, string> = {
  OPENING_BALANCE: 'Opening balance',
  DELIVERY_IN: 'Delivery in',
  DISTRIBUTION_OUT: 'Distribution out',
  ADJUSTMENT: 'Adjustment',
}

/** Builds and downloads a CSV file. Values are quoted and formulas are neutralised. */
export function downloadCsv(filename: string, columns: { key: string; label: string }[], rows: Record<string, unknown>[]) {
  const esc = (v: unknown) => {
    let s = v === null || v === undefined ? '' : String(v)
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
    return '"' + s.replace(/"/g, '""') + '"'
  }
  const lines = [columns.map((c) => esc(c.label)).join(',')]
  rows.forEach((r) => lines.push(columns.map((c) => esc(r[c.key])).join(',')))
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.csv') ? filename : filename + '.csv'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
