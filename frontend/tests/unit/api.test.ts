import { describe, expect, it, vi } from 'vitest'
import { ApiError, HttpTransport, api, newRequestId, type Transport } from '@/services/api'
import type { ApiEnvelope, RequestEnvelope } from '@/types/api'

function fakeTransport(handler: (body: RequestEnvelope) => ApiEnvelope): Transport & { calls: RequestEnvelope[] } {
  const calls: RequestEnvelope[] = []
  return { calls, async send<T>(body: RequestEnvelope) { calls.push(body); return handler(body) as ApiEnvelope<T> } }
}

describe('api client', () => {
  it('sends the session token in the body and returns data on success', async () => {
    const t = fakeTransport(() => ({ success: true, data: { ok: 1 }, message: '', error: null, requestId: 'r' }))
    api.configure({ transport: t, tokenProvider: () => 'tok.sig' })
    const data = await api.call<{ ok: number }>('items.list', { page: 2 })
    expect(data).toEqual({ ok: 1 })
    expect(t.calls[0].token).toBe('tok.sig')
    expect(t.calls[0].params).toEqual({ page: 2 })
    expect(t.calls[0].requestId).toMatch(/[0-9a-f-]{20,}/)
  })

  it('reuses a caller-supplied requestId so retries are idempotent', async () => {
    const t = fakeTransport(() => ({ success: true, data: null, message: '', error: null, requestId: 'x' }))
    api.configure({ transport: t, tokenProvider: () => 'tok' })
    const id = newRequestId()
    await api.call('deliveries.create', {}, { requestId: id })
    await api.call('deliveries.create', {}, { requestId: id })
    expect(t.calls.map((c) => c.requestId)).toEqual([id, id])
  })

  it('throws ApiError with the backend code and triggers the unauthenticated handler', async () => {
    const onUnauth = vi.fn()
    const t = fakeTransport(() => ({ success: false, data: null, message: 'Please sign in.', error: { code: 'UNAUTHENTICATED', message: 'Please sign in.' }, requestId: 'r' }))
    api.configure({ transport: t, tokenProvider: () => null, onUnauthenticated: onUnauth })
    await expect(api.call('items.list')).rejects.toMatchObject({ name: 'ApiError', code: 'UNAUTHENTICATED' })
    expect(onUnauth).toHaveBeenCalledOnce()
    // login failures must not trigger the global handler (the login page shows them inline)
    await expect(api.call('auth.login', { idToken: 'x' })).rejects.toBeInstanceOf(ApiError)
    expect(onUnauth).toHaveBeenCalledOnce()
  })

  it('HttpTransport posts text/plain JSON (no CORS preflight) and maps network failures', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>)['Content-Type']).toMatch(/^text\/plain/)
      expect(init.method).toBe('POST')
      expect(JSON.parse(String(init.body)).action).toBe('health')
      return new Response(JSON.stringify({ success: true, data: { service: 'x' }, message: '', error: null, requestId: null }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const res = await new HttpTransport('https://example.invalid/exec').send({ action: 'health' })
    expect(res.success).toBe(true)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    await expect(new HttpTransport('https://example.invalid/exec').send({ action: 'health' })).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>login</html>', { status: 200 })))
    await expect(new HttpTransport('https://example.invalid/exec').send({ action: 'health' })).rejects.toMatchObject({ code: 'BAD_RESPONSE' })
    vi.unstubAllGlobals()
  })
})
