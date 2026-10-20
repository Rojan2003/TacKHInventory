import { describe, expect, it } from 'vitest'
import { ADMIN_EMAIL, createHarness, loadBackendSources, seedScenario } from './harness'
import { createGasRuntime, defaultTokenInfoResolver } from '../../src/mock/gasRuntime'

describe('authentication', () => {
  it('seeds the initial administrator and lets them sign in with a verified Google identity', () => {
    const h = createHarness()
    const me = h.ok<any>('auth.me', {}, h.admin)
    expect(me.email).toBe(ADMIN_EMAIL)
    expect(me.role).toBe('admin')
    expect(me.permissions).toContain('users.manage')
  })

  it('rejects Google accounts that are not on the allowlist', () => {
    const h = createHarness()
    const res = h.call('auth.login', { idToken: 'mock:stranger@example.com' })
    expect(res.success).toBe(false)
    expect(res.error?.code).toBe('UNAUTHORIZED')
  })

  it('rejects ID tokens issued for a different OAuth client (audience mismatch)', () => {
    const rt = createGasRuntime({
      sources: loadBackendSources(),
      tokenInfoResolver: (t) => { const info = defaultTokenInfoResolver('other-client')(t); return info },
    })
    rt.setup()
    const res = rt.handleRequest({ action: 'auth.login', params: { idToken: `mock:${ADMIN_EMAIL}` }, requestId: 'r1' })
    expect(res.success).toBe(false)
    expect(res.error?.code).toBe('UNAUTHENTICATED')
  })

  it('rejects unverified email addresses and invalid tokens', () => {
    const rt = createGasRuntime({
      sources: loadBackendSources(),
      tokenInfoResolver: (t) => { const info = defaultTokenInfoResolver('mock-client-id.apps.googleusercontent.com')(t); return info ? { ...info, email_verified: 'false' } : null },
    })
    rt.setup()
    expect(rt.handleRequest({ action: 'auth.login', params: { idToken: `mock:${ADMIN_EMAIL}` }, requestId: 'r1' }).error?.code).toBe('UNAUTHENTICATED')
    expect(rt.handleRequest({ action: 'auth.login', params: { idToken: 'garbage' }, requestId: 'r2' }).error?.code).toBe('UNAUTHENTICATED')
  })

  it('rejects missing, tampered and forged session tokens', () => {
    const h = createHarness()
    expect(h.call('items.list', {}, null).error?.code).toBe('UNAUTHENTICATED')
    const [payload, sig] = h.admin.split('.')
    expect(h.call('items.list', {}, payload + '.' + sig.slice(0, -2) + 'xx').error?.code).toBe('UNAUTHENTICATED')
    // Forge a payload claiming to be admin with a bogus signature
    const forged = Buffer.from(JSON.stringify({ sub: ADMIN_EMAIL, exp: Math.floor(Date.now() / 1000) + 999 })).toString('base64url') + '.AAAA'
    expect(h.call('items.list', {}, forged).error?.code).toBe('UNAUTHENTICATED')
  })

  it('does not trust an email or role supplied in the request body', () => {
    const h = createHarness()
    const { west } = seedScenario(h)
    const res = h.call('users.list', { email: ADMIN_EMAIL, role: 'admin', user: { role: 'admin' } }, west)
    expect(res.success).toBe(false)
    expect(res.error?.code).toBe('FORBIDDEN')
  })

  it('deactivated users lose access immediately, and the last admin cannot be removed', () => {
    const h = createHarness()
    const { viewer } = seedScenario(h)
    const users = h.ok<any>('users.list', {}, h.admin).rows
    const viewerRow = users.find((u: any) => u.email === 'viewer@example.com')
    h.ok('users.update', { userId: viewerRow.userId, active: false }, h.admin)
    expect(h.call('items.list', {}, viewer).error?.code).toBe('UNAUTHORIZED')
    const adminRow = users.find((u: any) => u.email === ADMIN_EMAIL)
    expect(h.call('users.update', { userId: adminRow.userId, active: false }, h.admin).error?.code).toBe('VALIDATION_ERROR')
    expect(h.call('users.update', { userId: adminRow.userId, role: 'read_only' }, h.admin).error?.code).toBe('VALIDATION_ERROR')
  })

  it('unknown actions and GET requests never expose data', () => {
    const h = createHarness()
    expect(h.call('sheets.readAll', {}, h.admin).error?.code).toBe('NOT_FOUND')
    const get = h.rt.exports.doGet({}) as { getContent: () => string }
    const body = JSON.parse(get.getContent())
    expect(body.success).toBe(true)
    expect(Object.keys(body.data)).toEqual(['service', 'version', 'time'])
  })
})

describe('authorization matrix', () => {
  it('enforces roles on the server regardless of what the browser sends', () => {
    const h = createHarness()
    const { manager, west, viewer, items } = seedScenario(h)
    const forbidden = (action: string, params: Record<string, unknown>, token: string) => {
      const res = h.call(action, params, token)
      expect(res.success, `${action} should be forbidden`).toBe(false)
      expect(res.error?.code).toBe('FORBIDDEN')
    }
    // read-only
    forbidden('items.create', { sku: 'X', name: 'X' }, viewer)
    forbidden('deliveries.create', { deliveryDate: '2026-10-01', sourceName: 'Depot', receivedBy: 'A', items: [{ itemId: items[0].itemId, quantity: 1 }] }, viewer)
    forbidden('requests.create', { items: [{ itemId: items[0].itemId, quantity: 1 }] }, viewer)
    forbidden('users.list', {}, viewer)
    // congregation user
    forbidden('items.create', { sku: 'X', name: 'X' }, west)
    forbidden('deliveries.list', {}, west)
    forbidden('requests.approve', { requestId: 'x' }, west)
    forbidden('distributions.create', { requestId: 'x', items: [] }, west)
    forbidden('users.create', { email: 'a@b.co' }, west)
    forbidden('settings.update', { key: 'reserveOnApproval', value: 'false' }, west)
    forbidden('admin.reconcile', {}, west)
    forbidden('audit.list', {}, west)
    // inventory manager
    forbidden('users.list', {}, manager)
    forbidden('settings.update', { key: 'reserveOnApproval', value: 'false' }, manager)
    forbidden('congregations.save', { code: 'NEW', name: 'New' }, manager)
    // and things that must work
    expect(h.call('items.list', {}, viewer).success).toBe(true)
    expect(h.call('items.list', {}, west).success).toBe(true)
    expect(h.call('deliveries.list', {}, manager).success).toBe(true)
    expect(h.call('reports.run', { type: 'inventory' }, viewer).success).toBe(true)
    expect(h.call('reports.run', { type: 'inventory' }, west).error?.code).toBe('FORBIDDEN')
    expect(h.call('reports.run', { type: 'requests' }, west).success).toBe(true)
  })
})
