/**
 * Fake Google Apps Script runtime.
 *
 * Loads the real backend sources from ../../apps-script/src and executes them against in-memory
 * stand-ins for SpreadsheetApp, LockService, PropertiesService, CacheService, Utilities, UrlFetchApp
 * and ContentService. The same runtime powers:
 *   - the Vitest backend test suite (tests/backend/*.test.ts)
 *   - the browser "mock mode" (VITE_API_MODE=mock) so the UI runs end-to-end without a deployment
 *
 * It is NOT a bit-for-bit emulation of Apps Script; it models the subset the backend uses.
 */
import { hmacSha256, sha256, utf8Decode, utf8Encode } from './sha256'

export interface GasRuntimeOptions {
  sources: string[]
  spreadsheetId?: string
  /** Extra Script Properties present before setup() runs (e.g. CACHE_ENABLED). */
  initialProperties?: Record<string, string>
  clientId?: string
  /** Pre-populated worksheets (header row first), e.g. the legacy sheets. */
  initialSheets?: Record<string, unknown[][]>
  /** Resolves a mock id token to a tokeninfo payload; defaults to "mock:<email>[:<name>]". */
  tokenInfoResolver?: (idToken: string) => Record<string, unknown> | null
  verbose?: boolean
  /** Simulates the script lock being held by another execution. */
  lockBusy?: () => boolean
  /** Simulates SpreadsheetApp.openById failing. */
  spreadsheetUnavailable?: () => boolean
}

export interface RequestEnvelope {
  action: string
  token?: string
  requestId?: string
  params?: Record<string, unknown>
}

export interface ApiEnvelope<T = unknown> {
  success: boolean
  data: T
  message: string
  error: { code: string; message: string } | null
  requestId: string | null
}

export interface GasRuntime {
  handleRequest<T = unknown>(body: RequestEnvelope): ApiEnvelope<T>
  setup(): unknown
  snapshot(): RuntimeSnapshot
  load(snapshot: RuntimeSnapshot): void
  sheets: Map<string, FakeSheet>
  properties: Map<string, string>
  cache: Map<string, string>
  exports: Record<string, (...args: unknown[]) => unknown>
}

export interface RuntimeSnapshot {
  sheets: Record<string, unknown[][]>
  properties: Record<string, string>
}

/* ---------- Fake Sheets ---------- */

export class FakeRange {
  constructor(private sheet: FakeSheet, private row: number, private col: number, private numRows: number, private numCols: number) {}
  getValues(): unknown[][] {
    const out: unknown[][] = []
    for (let r = 0; r < this.numRows; r++) {
      const rowVals: unknown[] = []
      const src = this.sheet.data[this.row - 1 + r] || []
      for (let c = 0; c < this.numCols; c++) {
        const v = src[this.col - 1 + c]
        rowVals.push(v === undefined || v === null ? '' : v)
      }
      out.push(rowVals)
    }
    return out
  }
  setValues(values: unknown[][]): FakeRange {
    if (values.length !== this.numRows || values.some((r) => r.length !== this.numCols)) {
      throw new Error(`The number of rows/columns in the data does not match the range (${this.numRows}x${this.numCols}).`)
    }
    for (let r = 0; r < this.numRows; r++) {
      const idx = this.row - 1 + r
      while (this.sheet.data.length <= idx) this.sheet.data.push([])
      const target = this.sheet.data[idx]
      for (let c = 0; c < this.numCols; c++) {
        const ci = this.col - 1 + c
        while (target.length <= ci) target.push('')
        target[ci] = values[r][c]
      }
    }
    return this
  }
  setNumberFormat(): FakeRange { return this }
  setFontWeight(): FakeRange { return this }
}

export class FakeSheet {
  data: unknown[][]
  constructor(public name: string, data?: unknown[][]) {
    this.data = data ? data.map((r) => r.slice()) : []
  }
  getName(): string { return this.name }
  getLastRow(): number {
    let last = 0
    for (let i = 0; i < this.data.length; i++) {
      if (this.data[i].some((v) => v !== '' && v !== null && v !== undefined)) last = i + 1
    }
    return last
  }
  getLastColumn(): number {
    let last = 0
    for (const row of this.data) {
      for (let c = row.length - 1; c >= 0; c--) {
        if (row[c] !== '' && row[c] !== null && row[c] !== undefined) { if (c + 1 > last) last = c + 1; break }
      }
    }
    return last
  }
  getMaxRows(): number { return Math.max(1000, this.data.length) }
  getRange(row: number, col: number, numRows = 1, numCols = 1): FakeRange {
    if (row < 1 || col < 1 || numRows < 1 || numCols < 1) throw new Error('Invalid range')
    return new FakeRange(this, row, col, numRows, numCols)
  }
  setFrozenRows(): FakeSheet { return this }
}

class FakeSpreadsheet {
  constructor(public sheets: Map<string, FakeSheet>, private name: string) {}
  getName(): string { return this.name }
  getSheetByName(name: string): FakeSheet | null { return this.sheets.get(name) || null }
  insertSheet(name: string): FakeSheet {
    if (this.sheets.has(name)) throw new Error('A sheet with the name "' + name + '" already exists.')
    const s = new FakeSheet(name)
    this.sheets.set(name, s)
    return s
  }
  getSheets(): FakeSheet[] { return Array.from(this.sheets.values()) }
}

/* ---------- Byte helpers (Apps Script uses signed bytes) ---------- */

function toSignedBytes(u: Uint8Array): number[] { return Array.from(u, (b) => (b > 127 ? b - 256 : b)) }
function toUnsignedBytes(s: number[] | Uint8Array): Uint8Array { return Uint8Array.from(s, (b) => (b < 0 ? b + 256 : b)) }

function b64(bytes: Uint8Array, webSafe: boolean): string {
  let bin = ''
  bytes.forEach((b) => { bin += String.fromCharCode(b) })
  const std = typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64')
  return webSafe ? std.replace(/\+/g, '-').replace(/\//g, '_') : std
}

function unb64(s: string, webSafe: boolean): Uint8Array {
  let std = webSafe ? s.replace(/-/g, '+').replace(/_/g, '/') : s
  while (std.length % 4) std += '='
  const bin = typeof atob === 'function' ? atob(std) : Buffer.from(std, 'base64').toString('binary')
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

function uuid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

/* ---------- Runtime ---------- */

export function defaultTokenInfoResolver(clientId: string) {
  return (idToken: string): Record<string, unknown> | null => {
    if (!idToken.startsWith('mock:')) return null
    const [, email, name] = idToken.split(':')
    if (!email) return null
    return {
      aud: clientId, iss: 'https://accounts.google.com', email, email_verified: 'true',
      exp: String(Math.floor(Date.now() / 1000) + 3600), name: name || email.split('@')[0], sub: 'mock-' + email,
    }
  }
}

export function createGasRuntime(options: GasRuntimeOptions): GasRuntime {
  const spreadsheetId = options.spreadsheetId || 'mock-spreadsheet'
  const clientId = options.clientId || 'mock-client-id.apps.googleusercontent.com'
  const sheets = new Map<string, FakeSheet>()
  Object.entries(options.initialSheets || {}).forEach(([name, rows]) => sheets.set(name, new FakeSheet(name, rows)))
  const spreadsheet = new FakeSpreadsheet(sheets, 'Inventory and Distribution System (mock)')
  const properties = new Map<string, string>([['GOOGLE_CLIENT_ID', clientId], ['SPREADSHEET_ID', spreadsheetId], ...Object.entries(options.initialProperties || {})])
  const cache = new Map<string, string>()
  const resolver = options.tokenInfoResolver || defaultTokenInfoResolver(clientId)

  const SpreadsheetApp = {
    openById(id: string) {
      if (options.spreadsheetUnavailable && options.spreadsheetUnavailable()) throw new Error('Exception: Unexpected error while getting the method or property openById on object SpreadsheetApp.')
      if (id !== spreadsheetId) throw new Error('Requested entity was not found.')
      return spreadsheet
    },
  }
  const LockService = {
    getScriptLock() {
      return {
        tryLock: () => !(options.lockBusy && options.lockBusy()),
        waitLock: () => { if (options.lockBusy && options.lockBusy()) throw new Error('Lock timeout') },
        releaseLock: () => undefined,
      }
    },
  }
  const PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k: string) => (properties.has(k) ? properties.get(k)! : null),
      setProperty: (k: string, v: string) => { properties.set(k, String(v)) },
      deleteProperty: (k: string) => { properties.delete(k) },
    }),
  }
  const CacheService = {
    getScriptCache: () => ({
      get: (k: string) => (cache.has(k) ? cache.get(k)! : null),
      put: (k: string, v: string) => { cache.set(k, v) },
      remove: (k: string) => { cache.delete(k) },
    }),
  }
  const Utilities = {
    Charset: { UTF_8: 'UTF-8' },
    DigestAlgorithm: { SHA_256: 'SHA_256', SHA_512: 'SHA_512' },
    getUuid: () => uuid(),
    base64Encode: (input: number[] | string) => b64(typeof input === 'string' ? utf8Encode(input) : toUnsignedBytes(input), false),
    base64EncodeWebSafe: (input: number[] | string) => b64(typeof input === 'string' ? utf8Encode(input) : toUnsignedBytes(input), true),
    base64Decode: (s: string) => toSignedBytes(unb64(s, false)),
    base64DecodeWebSafe: (s: string) => toSignedBytes(unb64(s, true)),
    newBlob: (bytes: number[]) => ({ getDataAsString: () => utf8Decode(toUnsignedBytes(bytes)) }),
    computeHmacSha256Signature: (value: string, key: string) => toSignedBytes(hmacSha256(utf8Encode(key), utf8Encode(value))),
    computeDigest: (_algo: string, value: string) => toSignedBytes(sha256(utf8Encode(value))),
  }
  const UrlFetchApp = {
    fetch(url: string) {
      const m = /tokeninfo\?id_token=(.*)$/.exec(url)
      if (!m) return { getResponseCode: () => 404, getContentText: () => '' }
      const info = resolver(decodeURIComponent(m[1]))
      if (!info) return { getResponseCode: () => 400, getContentText: () => JSON.stringify({ error: 'invalid_token' }) }
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify(info) }
    },
  }
  const ContentService = {
    MimeType: { JSON: 'application/json' },
    createTextOutput: (text: string) => ({ _text: text, setMimeType() { return this }, getContent() { return this._text } }),
  }
  const fakeConsole = {
    log: (...a: unknown[]) => { if (options.verbose) console.log(...a) },
    error: (...a: unknown[]) => { if (options.verbose) console.error(...a) },
    warn: (...a: unknown[]) => { if (options.verbose) console.warn(...a) },
  }

  const exportedNames = ['handleRequest', 'setup', 'healthCheck', 'rotateSessionSecret', 'ensureSchema', 'doPost', 'doGet']
  const body = options.sources.join('\n;\n') + '\nreturn { ' + exportedNames.join(', ') + ' };'
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function('SpreadsheetApp', 'LockService', 'PropertiesService', 'CacheService', 'Utilities', 'UrlFetchApp', 'ContentService', 'console', body)
  const exports = factory(SpreadsheetApp, LockService, PropertiesService, CacheService, Utilities, UrlFetchApp, ContentService, fakeConsole) as Record<string, (...args: unknown[]) => unknown>

  return {
    sheets,
    properties,
    cache,
    exports,
    handleRequest<T>(req: RequestEnvelope): ApiEnvelope<T> {
      // Serialize through JSON exactly like the real transport would.
      const res = exports.handleRequest(JSON.parse(JSON.stringify(req)))
      return JSON.parse(JSON.stringify(res)) as ApiEnvelope<T>
    },
    setup: () => exports.setup(),
    snapshot(): RuntimeSnapshot {
      const out: RuntimeSnapshot = { sheets: {}, properties: {} }
      sheets.forEach((s, name) => { out.sheets[name] = s.data.map((r) => r.slice()) })
      properties.forEach((v, k) => { out.properties[k] = v })
      return out
    },
    load(snap: RuntimeSnapshot) {
      sheets.clear()
      Object.entries(snap.sheets).forEach(([name, rows]) => sheets.set(name, new FakeSheet(name, rows)))
      properties.clear()
      Object.entries(snap.properties).forEach(([k, v]) => properties.set(k, v))
      cache.clear()
    },
  }
}

/** The two worksheets that already exist in the production spreadsheet (structure verified 2026-10-20). */
export const LEGACY_SHEETS_SAMPLE: Record<string, unknown[][]> = {
  East_Inventory: [
    ['Literature Code', 'Literature Name', 'Total', 'Date'],
    ['LIT001', 'Awake', 10, '2026-05-05'],
    ['LIT002', 'Watchtower', 15, '2026-05-12'],
    ['LIT003', 'Insight', 5, '2026-05-15'],
    ['LIT001', 'Awake', 12, '2026-06-05'],
    ['LIT002', 'Watchtower', 20, '2026-06-10'],
    ['LIT003', 'Insight', 11, '2026-06-15'],
  ],
  Distribution: [
    ['Literature Code', 'Literature Name', 'Total', 'Date', 'Congregation'],
    ['LIT001', 'Awake', 10, '2026-04-01', 'East'],
    ['LIT002', 'Watchtower', 15, '2026-04-01', 'West'],
    ['LIT003', 'Insight', 5, '2026-04-01', 'Central'],
  ],
}
