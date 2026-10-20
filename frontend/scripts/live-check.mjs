// Opens the deployed sign-in page headlessly and reports whether the Google button rendered and any console/HTTP errors.
// Usage: node scripts/live-check.mjs [url]
import { chromium } from '@playwright/test'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
const logs = []
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text().slice(0, 200)) })
page.on('response', (r) => { if (r.status() >= 400) logs.push('HTTP ' + r.status() + ' ' + r.url().slice(0, 120)) })
await page.goto((process.argv[2] || 'https://rojan2003.github.io/TacKHInventory/') + '#/login', { waitUntil: 'networkidle' })
await page.waitForTimeout(4000)
const heading = await page.locator('h2').first().textContent().catch(() => null)
const gsiFrames = page.frames().filter((f) => f.url().includes('accounts.google.com/gsi')).length
const configError = await page.getByText(/not configured/).count()
const errorBox = await page.locator('[role=alert]').allTextContents()
console.log(JSON.stringify({ heading, gsiFrames, configError, errorBox, logs }, null, 1))
await page.screenshot({ path: 'test-results/live-login.png' })
await browser.close()
