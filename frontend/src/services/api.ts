/**
 * API client. All backend communication goes through here; Vue components never touch fetch or sheets.
 *
 * Transport: POST to the Apps Script web app with a text/plain body. Apps Script cannot answer CORS
 * preflight requests, and a text/plain POST without custom headers is a "simple request" that needs none.
 * The session token therefore travels in the body, over HTTPS.
 */
import type { ApiEnvelope, RequestEnvelope } from '@/types/api'

export class ApiError extends Error {
  code: string
  requestId: string | null
  constructor(code: string, message: string, requestId: string | null = null) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.requestId = requestId
  }
}

export interface Transport {
  send<T>(body: RequestEnvelope): Promise<ApiEnvelope<T>>
}

export class HttpTransport implements Transport {
  constructor(private baseUrl: string, private timeoutMs = 45000) {}

  async send<T>(body: RequestEnvelope): Promise<ApiEnvelope<T>> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const res = await fetch(this.baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
        redirect: 'follow',
        signal: controller.signal,
      })
      const text = await res.text()
      let parsed: ApiEnvelope<T>
      try {
        parsed = JSON.parse(text) as ApiEnvelope<T>
      } catch {
        throw new ApiError('BAD_RESPONSE', res.ok ? 'The server returned an unexpected response.' : `The server responded with HTTP ${res.status}.`)
      }
      return parsed
    } catch (err) {
      if (err instanceof ApiError) throw err
      if ((err as Error).name === 'AbortError') throw new ApiError('TIMEOUT', 'The server took too long to respond. Please try again.')
      throw new ApiError('NETWORK_ERROR', 'Could not reach the server. Check your connection and try again.')
    } finally {
      clearTimeout(timer)
    }
  }
}

export function newRequestId(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

type TokenProvider = () => string | null
type UnauthenticatedHandler = (err: ApiError) => void

class ApiClient {
  private transport: Transport | null = null
  private tokenProvider: TokenProvider = () => null
  private onUnauthenticated: UnauthenticatedHandler | null = null

  configure(opts: { transport: Transport; tokenProvider: TokenProvider; onUnauthenticated?: UnauthenticatedHandler }) {
    this.transport = opts.transport
    this.tokenProvider = opts.tokenProvider
    this.onUnauthenticated = opts.onUnauthenticated || null
  }

  /**
   * Calls a backend action. For mutations pass a stable requestId so that a retry of the same logical
   * submission (double click, refresh, network retry) is de-duplicated by the backend.
   */
  async call<T>(action: string, params: Record<string, unknown> = {}, options: { requestId?: string; token?: string | null } = {}): Promise<T> {
    if (!this.transport) throw new ApiError('NOT_CONFIGURED', 'API client is not configured.')
    const token = options.token === undefined ? this.tokenProvider() : options.token
    const body: RequestEnvelope = { action, params, requestId: options.requestId || newRequestId() }
    if (token) body.token = token
    const res = await this.transport.send<T>(body)
    if (!res || typeof res.success !== 'boolean') throw new ApiError('BAD_RESPONSE', 'The server returned an unexpected response.')
    if (!res.success) {
      const err = new ApiError(res.error?.code || 'UNKNOWN', res.error?.message || res.message || 'Request failed.', res.requestId)
      if (err.code === 'UNAUTHENTICATED' && this.onUnauthenticated && action !== 'auth.login') this.onUnauthenticated(err)
      throw err
    }
    return res.data
  }
}

export const api = new ApiClient()

export function describeError(err: unknown): string {
  if (err instanceof ApiError) return err.message
  if (err instanceof Error) return err.message
  return 'Something went wrong.'
}
