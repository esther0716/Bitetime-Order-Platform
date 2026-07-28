import { describe, it, expect } from 'vitest'
import { waDisplay, waHref } from './waNumber'

describe('waDisplay', () => {
  it('shows one format however the customer typed it', () => {
    for (const typed of ['0123456789', '60123456789', '+60123456789', '+60 12-345 6789', '012-345 6789']) {
      expect(waDisplay(typed)).toBe('+60 12-345 6789')
    }
  })

  it('groups a nine-digit subscriber number as NN-NNN NNNN', () => {
    expect(waDisplay('0198765432')).toBe('+60 19-876 5432')
  })

  it('groups a ten-digit subscriber number as NN-NNNN NNNN', () => {
    expect(waDisplay('01123456789')).toBe('+60 11-2345 6789')
  })

  it('leaves a number from another country exactly as the customer typed it', () => {
    // Not ours to reformat: the grouping below is Malaysian, and applying it to a Singapore
    // or Indonesian number would print a number that reads wrong to the person dialling it.
    expect(waDisplay('+65 9123 4567')).toBe('+65 9123 4567')
    expect(waDisplay('6591234567')).toBe('6591234567')
  })

  it('leaves a Malaysian landline ungrouped rather than grouping it as a mobile', () => {
    // Landlines are 03-1234 5678, not 31-234 5678. WhatsApp numbers are mobiles in practice,
    // so the mobile grouping applies only to mobile prefixes and everything else is left alone.
    expect(waDisplay('0312345678')).toBe('+60 312345678')
  })

  it('hands back anything unrecognisable untouched rather than inventing a shape', () => {
    for (const junk of ['', '   ', 'call me', '0', '+60']) {
      expect(waDisplay(junk)).toBe(junk)
    }
  })
})

describe('waHref', () => {
  it('dials the international form, whichever way the number was typed', () => {
    for (const typed of ['0123456789', '60123456789', '+60 12-345 6789']) {
      expect(waHref(typed)).toBe('https://wa.me/60123456789')
    }
  })

  it('drops the leading zero — wa.me resolves nothing for a local-format number', () => {
    // The bug this replaces: `wa.me/0198765432` is a dead link, and the merchant only finds
    // out after tapping it in front of a customer they meant to message.
    expect(waHref('0198765432')).toBe('https://wa.me/60198765432')
  })

  it('passes a foreign number through as its own digits', () => {
    expect(waHref('+65 9123 4567')).toBe('https://wa.me/6591234567')
  })

  it('is null when there is no number to dial', () => {
    for (const junk of ['', '   ', 'call me']) {
      expect(waHref(junk)).toBeNull()
    }
  })
})
