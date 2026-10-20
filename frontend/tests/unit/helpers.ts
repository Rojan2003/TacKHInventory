export { downloadCsv, formatNumber, signed } from '@/utils/format'

export function toIsoDateOrEmpty(v: string): string {
  return v ? v.slice(0, 10) : ''
}
