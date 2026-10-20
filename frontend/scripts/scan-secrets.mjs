#!/usr/bin/env node
/**
 * Lightweight secret scanner for source trees and build output.
 * Usage: node scripts/scan-secrets.mjs [dir ...]   (defaults to ../ i.e. the repository, skipping node_modules/.git)
 * Exits 1 when a likely credential is found. Matches are reported by file and line only; the value is never printed.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve, extname } from 'node:path'

const PATTERNS = [
  { name: 'Google API key', re: /AIza[0-9A-Za-z_-]{35}/ },
  { name: 'Google OAuth client secret', re: /GOCSPX-[0-9A-Za-z_-]{20,}/ },
  { name: 'Google OAuth access/refresh token', re: /\b(ya29\.[0-9A-Za-z_-]{30,}|1\/\/0[0-9A-Za-z_-]{40,})/ },
  { name: 'Private key block', re: /-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { name: 'Service account JSON', re: /"type"\s*:\s*"service_account"/ },
  { name: 'AWS access key', re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: 'GitHub token', re: /\b(ghp|gho|ghu|ghs|ghr)_[0-9A-Za-z]{36,}\b/ },
  { name: 'Slack token', re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/ },
  { name: 'Hardcoded password assignment', re: /\b(password|passwd|pwd)\s*[:=]\s*["'][^"']{4,}["']/i },
  { name: 'Session/HMAC secret literal', re: /\b(SESSION_SECRET|HMAC_SECRET|CLIENT_SECRET)\s*[:=]\s*["'][^"']{8,}["']/ },
  { name: 'Generic secret literal', re: /\b(api[_-]?key|secret[_-]?key|access[_-]?token)\s*[:=]\s*["'][A-Za-z0-9_\-]{16,}["']/i },
]

const SKIP_DIRS = new Set(['node_modules', '.git', 'coverage', 'test-results', 'playwright-report'])
const SKIP_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.eot', '.lock', '.zip'])
const ALLOWLIST = [/scan-secrets\.mjs$/, /\.env\.example$/, /SECURITY\.md$/, /package-lock\.json$/]

const roots = process.argv.slice(2).length ? process.argv.slice(2) : [resolve(process.cwd(), '..')]
let findings = 0
let scanned = 0

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    const st = statSync(p)
    if (st.isDirectory()) { if (!SKIP_DIRS.has(entry)) walk(p); continue }
    if (SKIP_EXT.has(extname(entry).toLowerCase()) || st.size > 5_000_000) continue
    if (ALLOWLIST.some((re) => re.test(p))) continue
    scanned += 1
    const text = readFileSync(p, 'utf8')
    const lines = text.split(/\r?\n/)
    lines.forEach((line, i) => {
      for (const { name, re } of PATTERNS) {
        if (re.test(line)) { findings += 1; console.log(`::warning file=${p},line=${i + 1}::possible ${name}`) }
      }
    })
  }
}

for (const r of roots) walk(resolve(r))
console.log(`Scanned ${scanned} files in ${roots.join(', ')}: ${findings} possible secret(s).`)
process.exit(findings ? 1 : 0)
