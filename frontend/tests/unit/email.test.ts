import { describe, expect, it } from 'vitest'
import { analyzeEmail, BACKEND_EMAIL_RE, cleanEmail } from '@/utils/email'

describe('cleanEmail', () => {
  it('removes surrounding spaces, invisible characters and a pasted mailto: prefix', () => {
    expect(cleanEmail('  someone@gmail.com  ')).toBe('someone@gmail.com')
    expect(cleanEmail(' someone@gmail.com ')).toBe('someone@gmail.com')
    expect(cleanEmail('some​one@gmail.com﻿')).toBe('someone@gmail.com')
    expect(cleanEmail('‪someone@gmail.com‬')).toBe('someone@gmail.com')
    expect(cleanEmail('mailto:someone@gmail.com')).toBe('someone@gmail.com')
    expect(cleanEmail(null)).toBe('')
  })
})

describe('analyzeEmail hints', () => {
  const hint = (s: string) => analyzeEmail(s).hint
  it('names the specific problem', () => {
    expect(hint('')).toBe('Enter an email address.')
    expect(hint('some one@gmail.com')).toBe('Remove the space.')
    expect(hint('someone.gmail.com')).toBe('Missing the @.')
    expect(hint('some@one@gmail.com')).toBe('Only one @ is allowed.')
    expect(hint('@gmail.com')).toBe('Missing the part before the @.')
    expect(hint('someone@')).toBe('Missing the part after the @.')
    expect(hint('someone@gmail')).toBe('Missing the ending, like .com.')
    expect(hint('someone@gmail.')).toBe('The ending is incomplete.')
    expect(hint('someone@gmail..com')).toBe('The ending is incomplete.')
    expect(hint('someone@gmail.com')).toBeNull()
  })

  it('agrees with the backend pattern on validity', () => {
    const good = ['a@b.co', 'first.last+tag@sub.example.org', 'congregationliterature@gmail.com', 'x@y.z']
    const bad = ['', 'plain', 'a@b', 'a@b.', 'a b@c.com', '@c.com', 'a@', 'a@@b.com']
    good.forEach((e) => { expect(analyzeEmail(e).valid, e).toBe(true); expect(BACKEND_EMAIL_RE.test(e)).toBe(true) })
    bad.forEach((e) => { expect(analyzeEmail(e).valid, e).toBe(false); expect(BACKEND_EMAIL_RE.test(e)).toBe(false) })
    // cleaning happens before the check, so a pasted address with spaces around it is valid
    expect(analyzeEmail('  someone@gmail.com ').valid).toBe(true)
    expect(analyzeEmail('  someone@gmail.com ').value).toBe('someone@gmail.com')
  })
})

describe('analyzeEmail suggestions', () => {
  const suggestion = (s: string) => analyzeEmail(s).suggestion
  it('offers gmail.com for an unfinished or misspelt Gmail domain', () => {
    expect(suggestion('someone@gmail')).toBe('someone@gmail.com')
    expect(suggestion('someone@gmail.')).toBe('someone@gmail.com')
    expect(suggestion('someone@gmial.com')).toBe('someone@gmail.com')
    expect(suggestion('someone@gamil.com')).toBe('someone@gmail.com')
    expect(suggestion('someone@gmail.con')).toBe('someone@gmail.com')
    expect(suggestion('someone@gmail.cm')).toBe('someone@gmail.com')
    expect(suggestion('someone@gmail.co')).toBe('someone@gmail.com')
    expect(suggestion('Someone@GMIAL.COM')).toBe('Someone@gmail.com')
  })

  it('handles the other known domains', () => {
    expect(suggestion('someone@yaho.com')).toBe('someone@yahoo.com')
    expect(suggestion('someone@hotmail.con')).toBe('someone@hotmail.com')
    expect(suggestion('someone@outlok.com')).toBe('someone@outlook.com')
  })

  it('never suggests for correct, real or unrelated domains', () => {
    expect(suggestion('someone@gmail.com')).toBeNull()
    expect(suggestion('someone@googlemail.com')).toBeNull()
    expect(suggestion('someone@ymail.com')).toBeNull()   // one edit from gmail.com, but real
    expect(suggestion('someone@mail.com')).toBeNull()    // one edit from gmail.com, but real
    expect(suggestion('someone@email.com')).toBeNull()
    expect(suggestion('someone@aol.com')).toBeNull()
    expect(suggestion('someone@hotmail.co.uk')).toBeNull()
    expect(suggestion('someone@example.co')).toBeNull()
    expect(suggestion('someone@bigdogbuilds.com')).toBeNull()
    expect(suggestion('someone')).toBeNull()
    expect(suggestion('@gmail')).toBeNull()
  })
})

describe('analyzeEmail Google note', () => {
  it('flags addresses that are not gmail.com or googlemail.com', () => {
    expect(analyzeEmail('someone@gmail.com').isGoogleDomain).toBe(true)
    expect(analyzeEmail('someone@GoogleMail.com').isGoogleDomain).toBe(true)
    expect(analyzeEmail('someone@bigdogbuilds.com').isGoogleDomain).toBe(false)
    expect(analyzeEmail('someone@yahoo.com').isGoogleDomain).toBe(false)
  })
})
