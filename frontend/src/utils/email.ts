/**
 * Email hints for the "Add user" dialog. Pure functions, no network.
 * The validity rule is exactly the backend's isValidEmail() pattern; everything else here only helps the
 * person typing. Suggestions are offered, never applied automatically.
 */

/** Same pattern as apps-script/src/01_Util.js isValidEmail(). */
export const BACKEND_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Domains we suggest when the typed domain is within one edit of them. */
export const KNOWN_DOMAINS = ['gmail.com', 'googlemail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'protonmail.com', 'jwpub.org'] as const

/** Real domains that never get a suggestion, even when they are one edit from a known domain. */
export const REAL_DOMAINS = new Set<string>([
  ...KNOWN_DOMAINS,
  'mail.com', 'ymail.com', 'email.com', 'gmx.com', 'aol.com', 'live.com', 'me.com', 'msn.com', 'hotmail.co.uk', 'yahoo.co.uk',
])

const GOOGLE_DOMAINS = new Set(['gmail.com', 'googlemail.com'])

export interface EmailAnalysis {
  /** Cleaned address: trimmed, invisible characters and a pasted "mailto:" removed. Send this to the backend. */
  value: string
  /** What is wrong, in plain words, or null when the address passes the backend rule. */
  hint: string | null
  valid: boolean
  /** A corrected address to offer, or null. Never applied automatically. */
  suggestion: string | null
  /** gmail.com / googlemail.com; other domains get the "must sign in with a Google account" note. */
  isGoogleDomain: boolean
  /** True when the typed address was completed to its Google form ("@gmail" -> "@gmail.com"). */
  normalized: boolean
}

/** Strips surrounding whitespace, non-breaking spaces, zero-width and direction characters, and a "mailto:" prefix. */
export function cleanEmail(raw: unknown): string {
  return String(raw ?? '')
    .replace(/[​-‍﻿­‎‏‪-‮⁠⁦-⁩]/g, '')
    .replace(/ /g, ' ')
    .trim()
    .replace(/^mailto:/i, '')
    .trim()
}

/** Optimal string alignment distance capped at 2 (one insertion, deletion, substitution or adjacent swap counts as 1). */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true
  if (Math.abs(a.length - b.length) > 1) return false
  const prev2: number[] = [], prev: number[] = [], cur: number[] = []
  for (let j = 0; j <= b.length; j++) prev[j] = j
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i
    let rowMin = cur[0]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1)
      cur[j] = v
      if (v < rowMin) rowMin = v
    }
    if (rowMin > 1) return false
    for (let j = 0; j <= b.length; j++) { prev2[j] = prev[j]; prev[j] = cur[j] }
  }
  return prev[b.length] <= 1
}

function suggestDomain(value: string): string | null {
  const at = value.indexOf('@')
  if (at <= 0) return null
  const local = value.slice(0, at)
  const rawDomain = value.slice(at + 1)
  if (!rawDomain || rawDomain.includes('@') || /\s/.test(rawDomain)) return null
  const domain = rawDomain.toLowerCase().replace(/\.+$/, '')
  if (!domain || REAL_DOMAINS.has(domain)) return null
  if (domain === 'gmail' || domain === 'googlemail') return `${local}@${domain}.com`
  for (const known of KNOWN_DOMAINS) {
    if (withinOneEdit(domain, known)) return `${local}@${known}`
  }
  return null
}

function hintFor(value: string): string | null {
  if (!value) return 'Enter an email address.'
  if (/\s/.test(value)) return 'Remove the space.'
  const parts = value.split('@')
  if (parts.length === 1) return 'Missing the @.'
  if (parts.length > 2) return 'Only one @ is allowed.'
  const [local, domain] = parts
  if (!local) return 'Missing the part before the @.'
  if (!domain) return 'Missing the part after the @.'
  if (!domain.includes('.')) return 'Missing the ending, like .com.'
  if (/^\.|\.$|\.\./.test(domain)) return 'The ending is incomplete.'
  if (!BACKEND_EMAIL_RE.test(value)) return 'Check the characters in the address.'
  return null
}

export function analyzeEmail(raw: unknown): EmailAnalysis {
  const typed = cleanEmail(raw)
  // Exception: "" / "" without the ending is accepted; the backend stores and compares it as ".com".
  const value = /@(gmail|googlemail)$/i.test(typed) ? typed + '.com' : typed
  const hint = hintFor(value)
  const domain = value.includes('@') ? value.slice(value.indexOf('@') + 1).toLowerCase() : ''
  return {
    value,
    hint,
    valid: hint === null && BACKEND_EMAIL_RE.test(value),
    suggestion: suggestDomain(value),
    isGoogleDomain: GOOGLE_DOMAINS.has(domain),
    normalized: value !== typed,
  }
}
