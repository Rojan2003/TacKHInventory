/**
 * End-to-end smoke tests. They run against the Vite dev server in mock mode, where the real Apps Script
 * backend executes inside the browser against an in-memory spreadsheet. No Google services are contacted.
 */
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const SHOTS = process.env.E2E_SHOTS || 'test-results/screenshots'
mkdirSync(SHOTS, { recursive: true })

async function shot(page: Page, name: string) {
  const vp = page.viewportSize()
  await page.screenshot({ path: `${SHOTS}/${name}-${vp?.width}x${vp?.height}.png`, fullPage: true })
}

async function noHorizontalOverflow(page: Page) {
  const result = await page.evaluate(() => {
    const w = document.documentElement.clientWidth
    const overflow = document.documentElement.scrollWidth - w
    const culprits: string[] = []
    if (overflow > 0) {
      document.querySelectorAll('body *').forEach((el) => {
        const r = el.getBoundingClientRect()
        if (r.right > w + 0.5 && r.width > 0) culprits.push(`${el.tagName.toLowerCase()}.${String((el as HTMLElement).className).split(' ').slice(0, 3).join('.')} right=${Math.round(r.right)}`)
      })
    }
    return { overflow, culprits: culprits.slice(0, 8) }
  })
  expect(result.overflow, `page should not scroll horizontally; offenders: ${result.culprits.join(' | ')}`).toBeLessThanOrEqual(0)
}

async function loginAs(page: Page, name: string) {
  await page.goto('/#/login')
  await page.evaluate(() => localStorage.removeItem('ecli.session.v1'))
  await page.goto('/#/login')
  await page.getByRole('button', { name: new RegExp(name) }).click()
  await expect(page).toHaveURL(/#\/($|\?|inventory|requests)/)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
}

async function logout(page: Page) {
  const isMobile = (page.viewportSize()?.width || 0) < 1024
  if (isMobile) await page.getByRole('button', { name: 'Open menu' }).click()
  await page.getByRole('button', { name: 'Sign out' }).first().click()
  await expect(page).toHaveURL(/#\/login/)
}

async function nav(page: Page, label: string) {
  const isMobile = (page.viewportSize()?.width || 0) < 1024
  if (isMobile) await page.getByRole('button', { name: 'Open menu' }).click()
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: label }).first().click()
}


async function selectByText(page: Page, label: string, text: string | RegExp, nth = 0) {
  const select = page.getByLabel(label).nth(nth)
  const value = await select.locator('option', { hasText: text }).first().getAttribute('value')
  expect(value, `option matching ${text} should exist`).toBeTruthy()
  await select.selectOption(value!)
}

async function statValue(page: Page, label: string): Promise<number> {
  const text = await page.getByText(label, { exact: true }).first().locator('..').locator('p.text-2xl').textContent()
  return Number((text || '').replace(/,/g, ''))
}

test.describe.configure({ mode: 'serial' })

test('login page: unauthorized account is rejected with a clear message', async ({ page }) => {
  await page.goto('/#/login')
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  await expect(page.getByText('Access is restricted')).toBeVisible()
  await shot(page, '01-login')
  await noHorizontalOverflow(page)
  await page.getByRole('button', { name: /Unauthorized Account/ }).click()
  await expect(page.getByText('This account is not authorized.')).toBeVisible()
  await expect(page).toHaveURL(/#\/login/)
})

test('administrator: dashboard, inventory and item creation', async ({ page }) => {
  await loginAs(page, 'Initial Administrator')
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await expect(page.getByText('Physical stock', { exact: true })).toBeVisible()
  await expect(page.getByText('Low-stock items', { exact: false }).first()).toBeVisible()
  await shot(page, '02-dashboard')
  await noHorizontalOverflow(page)

  await nav(page, 'Literature Inventory')
  await expect(page.getByRole('heading', { name: 'Literature Inventory' })).toBeVisible()
  await expect(page.getByText('LIT001').filter({ visible: true }).first()).toBeVisible()
  await shot(page, '03-inventory')
  await noHorizontalOverflow(page)

  await page.getByRole('button', { name: 'Add item' }).click()
  await page.getByLabel('Item code / SKU').fill('LIT099')
  await page.getByLabel('Literature name').fill('E2E Test Brochure')
  await page.getByLabel('Opening quantity').fill('12')
  await page.getByRole('button', { name: 'Create item' }).click()
  await expect(page.getByText('Item saved')).toBeVisible()
  await page.getByPlaceholder(/Search code/).fill('LIT099')
  await expect(page.getByText('E2E Test Brochure').filter({ visible: true }).first()).toBeVisible()

  await page.getByText('E2E Test Brochure').filter({ visible: true }).first().click()
  await expect(page.getByRole('heading', { name: 'E2E Test Brochure' })).toBeVisible()
  await expect(page.getByText('Opening balance').filter({ visible: true }).first()).toBeVisible()
  await shot(page, '04-item-detail')
  await logout(page)
})

test('inventory manager: pending delivery does not change stock, confirmation does (once)', async ({ page }) => {
  await loginAs(page, 'Congregation Literature Servant')
  await nav(page, 'Incoming Deliveries')
  await page.getByRole('link', { name: 'Record delivery' }).click()
  await page.getByLabel('Supplier name').fill('E2E Depot')
  await page.getByLabel('Received by').fill('Bro. Tester')
  await selectByText(page, 'Literature item', /LIT003/)
  await page.getByLabel('Quantity').first().fill('7')
  await page.getByRole('button', { name: 'Record as pending' }).click()
  await expect(page.getByRole('heading', { name: /Delivery DLV-/ })).toBeVisible()
  await expect(page.getByText('Not yet (stock unchanged)')).toBeVisible()
  await shot(page, '05-delivery-pending')

  await nav(page, 'Literature Inventory')
  await page.getByPlaceholder(/Search code/).fill('LIT003')
  await page.getByText('Insight on the Scriptures').filter({ visible: true }).first().click()
  await expect(page.getByRole('heading', { name: 'Insight on the Scriptures' })).toBeVisible()
  expect(await statValue(page, 'Physical')).toBe(26) // 6 opening + 20 seeded confirmed delivery; pending +7 not counted

  await nav(page, 'Incoming Deliveries')
  await page.getByText('E2E Depot').filter({ visible: true }).first().click()
  await page.getByRole('button', { name: 'Confirm receipt' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm receipt' }).click()
  await expect(page.getByText('Delivery confirmed and stock updated')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Confirm receipt' })).toHaveCount(0)
  await shot(page, '05b-delivery-confirmed')

  await nav(page, 'Literature Inventory')
  await page.getByPlaceholder(/Search code/).fill('LIT003')
  await page.getByText('Insight on the Scriptures').filter({ visible: true }).first().click()
  await expect(page.getByText('Delivery in').filter({ visible: true }).first()).toBeVisible()
  // The cached item page paints first (26) and refreshes in the background after the confirmation.
  await expect.poll(() => statValue(page, 'Physical'), { timeout: 10_000 }).toBe(33)
  await logout(page)
})

test('congregation request → approval → release → receipt → confirmation', async ({ page }) => {
  // West secretary submits a request
  await loginAs(page, 'West Literature Overseer')
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await nav(page, 'Congregation Requests')
  await page.getByRole('link', { name: 'New request' }).click()
  await expect(page.getByLabel('Requesting congregation')).toHaveValue('West Congregation')
  await selectByText(page, 'Literature item', /LIT002/)
  await page.getByLabel('Quantity').first().fill('8')
  await page.getByRole('button', { name: 'Submit for approval' }).click()
  await expect(page.getByRole('heading', { name: /Request REQ-/ })).toBeVisible()
  await expect(page.getByText('Pending').first()).toBeVisible()
  const requestNumber = (await page.getByRole('heading', { name: /Request REQ-/ }).textContent())!.replace('Request ', '').trim()
  await shot(page, '06-request-pending')
  await logout(page)

  // Manager approves and releases
  await loginAs(page, 'Congregation Literature Servant')
  await nav(page, 'Congregation Requests')
  await page.getByText(requestNumber).filter({ visible: true }).first().click()
  await page.getByRole('button', { name: 'Approve…' }).click()
  await page.getByRole('button', { name: 'Approve request' }).click()
  await expect(page.getByText('Request approved')).toBeVisible()
  await expect(page.getByText('Approved').first()).toBeVisible()
  await page.getByRole('link', { name: 'Release literature' }).click()
  await expect(page.getByRole('heading', { name: 'Release literature' })).toBeVisible()
  await expect(page.getByLabel('Approved request')).toHaveValue(/^req_/)
  await expect(page.locator('div.bg-brand-50').getByText(requestNumber)).toBeVisible()
  await shot(page, '07-distribution-form')
  await page.getByRole('button', { name: 'Release and print receipt' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Release' }).click()
  await expect(page.getByRole('heading', { name: /Distribution DST-/ })).toBeVisible()
  await expect(page.getByText('Distribution Receipt')).toBeVisible()
  await expect(page.getByText('Released').first()).toBeVisible()
  await shot(page, '08-receipt')
  await noHorizontalOverflow(page)
  const reference = (await page.getByRole('heading', { name: /Distribution DST-/ }).textContent())!.replace('Distribution ', '').trim()

  // Request is now fulfilled
  await nav(page, 'Congregation Requests')
  await page.getByText(requestNumber).filter({ visible: true }).first().click()
  await expect(page.getByText('Fulfilled').first()).toBeVisible()
  await logout(page)

  // West confirms receipt; SLC cannot see it
  await loginAs(page, 'SLC Literature Overseer')
  await nav(page, 'Distributions')
  await expect(page.getByText(reference)).toHaveCount(0)
  await logout(page)

  await loginAs(page, 'West Literature Overseer')
  await nav(page, 'Distributions')
  await page.getByText(reference).filter({ visible: true }).first().click()
  await page.getByRole('button', { name: 'Confirm receipt' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm received' }).click()
  await expect(page.getByText('Receipt confirmed')).toBeVisible()
  await expect(page.getByText('Received').first()).toBeVisible()
  await nav(page, 'Congregation Stock')
  await expect(page.getByText('Confirmed received (all time)').first()).toBeVisible()
  await shot(page, '09-congregation-stock')
  await logout(page)
})

test('read-only user: no mutation controls, admin area is blocked, reports export', async ({ page }) => {
  await loginAs(page, 'Read-Only Viewer')
  await nav(page, 'Literature Inventory')
  await expect(page.getByRole('button', { name: 'Add item' })).toHaveCount(0)
  await page.goto('/#/admin')
  await expect(page.getByText("You don't have access to this page")).toBeVisible()
  await nav(page, 'Reports')
  await page.getByRole('button', { name: 'Run report' }).click()
  await expect(page.getByRole('heading', { name: 'Current Inventory (East Congregation)' })).toBeVisible()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export CSV' }).click()
  expect((await download).suggestedFilename()).toMatch(/^inventory_.*\.csv$/)
  await shot(page, '10-reports')
  await noHorizontalOverflow(page)
  await logout(page)
})

test('administrator: user management and reconciliation', async ({ page }) => {
  await loginAs(page, 'Initial Administrator')
  await nav(page, 'User Management')
  await expect(page.getByRole('heading', { name: 'User Management' })).toBeVisible()
  await expect(page.getByText('manager@example.com', { exact: true }).filter({ visible: true }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Authorize account' }).click()
  // live hints: unfinished domain -> hint + one-click suggestion that only applies when clicked
  await page.getByLabel('Google account email').fill('newperson@gmai')
  await expect(page.getByText('Missing the ending, like .com.')).toBeVisible()
  await page.getByLabel('Google account email').fill('newperson@gmail')
  await expect(page.getByTestId('email-normalized-note')).toContainText('newperson@gmail.com')
  await page.getByLabel('Google account email').fill('newperson@gmial.com')
  await expect(page.getByTestId('email-suggestion')).toContainText('newperson@gmail.com')
  await expect(page.getByLabel('Google account email')).toHaveValue('newperson@gmial.com')
  await page.getByTestId('email-suggestion').click()
  await expect(page.getByLabel('Google account email')).toHaveValue('newperson@gmail.com')
  await expect(page.getByTestId('email-suggestion')).toHaveCount(0)
  await expect(page.getByTestId('email-google-note')).toHaveCount(0)
  await page.getByLabel('Google account email').fill('  newperson@example.com ')
  await expect(page.getByTestId('email-google-note')).toBeVisible()
  await page.getByRole('dialog').getByLabel('Role').selectOption('congregation_user')
  await page.getByRole('dialog').getByRole('button', { name: 'Authorize', exact: true }).click()
  await expect(page.getByText('Congregation users must be linked')).toBeVisible()
  await page.getByRole('dialog').getByLabel('Congregation').selectOption({ label: 'Central Congregation' })
  await page.getByRole('dialog').getByRole('button', { name: 'Authorize', exact: true }).click()
  await expect(page.getByText('User saved')).toBeVisible()
  await expect(page.getByText('newperson@example.com', { exact: true }).filter({ visible: true }).first()).toBeVisible()
  await shot(page, '11-users')
  // a misspelt domain is suggested but never changed on its own: the address is saved exactly as typed
  await page.getByRole('button', { name: 'Authorize account' }).click()
  await page.getByLabel('Google account email').fill('someone@gmial.com')
  await expect(page.getByTestId('email-suggestion')).toContainText('someone@gmail.com')
  await page.getByRole('dialog').getByRole('button', { name: 'Authorize', exact: true }).click()
  await expect(page.getByText('User saved').last()).toBeVisible()
  await expect(page.getByText('someone@gmial.com', { exact: true }).filter({ visible: true }).first()).toBeVisible()
  await page.getByRole('tab', { name: 'Maintenance' }).click()
  await page.getByRole('button', { name: 'Dry run' }).first().click()
  await expect(page.getByText('Everything is consistent.')).toBeVisible()
  await noHorizontalOverflow(page)
  await logout(page)
})

test('cached pages paint instantly on a second visit and refresh in the background', async ({ page }) => {
  await loginAs(page, 'Initial Administrator')
  await expect(page.getByText('Physical stock', { exact: true })).toBeVisible()
  await expect(page.locator('.animate-pulse')).toHaveCount(0)
  await nav(page, 'Literature Inventory')
  await expect(page.getByText('LIT001').filter({ visible: true }).first()).toBeVisible()
  await nav(page, 'Dashboard')
  // Second visit: the cached summary is rendered at once; no skeleton placeholder is ever shown.
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  expect(await page.locator('.animate-pulse').count()).toBe(0)
  await expect(page.getByText('Physical stock', { exact: true })).toBeVisible()
  await nav(page, 'Literature Inventory')
  expect(await page.locator('.animate-pulse').count()).toBe(0)
  await expect(page.getByText('LIT001').filter({ visible: true }).first()).toBeVisible()
  await logout(page)
})

test('paste packing list: dry run, create pending delivery, confirm posts stock', async ({ page }) => {
  await loginAs(page, 'Initial Administrator')
  await nav(page, 'Incoming Deliveries')
  await page.getByRole('button', { name: 'Paste packing list' }).click()
  await page.getByLabel('Packing list text').fill('Packing List  3770278\n30 - g26.1-E | English - Awake!\n150 - g26.1-TG | Tagalog - Awake!\n2 - ldstd-2-E | Literature Display Stand - Double-sided')
  await page.getByRole('button', { name: 'Check', exact: true }).click()
  await expect(page.getByTestId('packing-plan')).toBeVisible()
  await expect(page.getByText('Will be created')).toHaveCount(3)
  await expect(page.getByText('Literature Display Stand - Double-sided (English)')).toBeVisible()
  await shot(page, '13-packing-list-check')
  await page.getByRole('button', { name: /^Create 1 delivery$/ }).click()
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page.getByText('1 delivery created')).toBeVisible()
  await expect(page.getByRole('heading', { name: /Delivery DLV-/ })).toBeVisible()
  await expect(page.getByText('3770278').first()).toBeVisible()
  await expect(page.getByText('Not yet (stock unchanged)')).toBeVisible()
  await page.getByRole('button', { name: 'Confirm receipt' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm receipt' }).click()
  await expect(page.getByText('Delivery confirmed and stock updated')).toBeVisible()
  await nav(page, 'Literature Inventory')
  await page.getByPlaceholder(/Search code/).fill('g26.1-TG')
  await page.getByText('Awake! (Tagalog)').filter({ visible: true }).first().click()
  await expect(page.getByRole('heading', { name: 'Awake! (Tagalog)' })).toBeVisible()
  await expect.poll(() => statValue(page, 'Physical'), { timeout: 10_000 }).toBe(150)
  // the same list again is refused
  await nav(page, 'Incoming Deliveries')
  await page.getByRole('button', { name: 'Paste packing list' }).click()
  await page.getByLabel('Packing list text').fill('Packing List 3770278\n30 - g26.1-E | English - Awake!')
  await page.getByRole('button', { name: 'Check', exact: true }).click()
  await expect(page.getByText('Already entered', { exact: true })).toBeVisible()
  await expect(page.getByText(/was already entered as delivery DLV-/)).toBeVisible()
  await expect(page.getByRole('button', { name: /^Create/ })).toBeDisabled()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await logout(page)
})
