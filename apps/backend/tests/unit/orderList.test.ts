import { describe, it, expect } from 'vitest'
import {
  parseOrderList, searchTerm, ORDERS_PAGE_SIZE, MAX_ORDERS_PAGE_SIZE,
} from '../../src/orderList.js'

const q = (s: string) => new URLSearchParams(s)

describe('parseOrderList', () => {
  it('defaults to page 1 of newest-first, with no search', () => {
    const r = parseOrderList(q(''))
    expect(r).toEqual({
      ok: true,
      query: { page: 1, pageSize: ORDERS_PAGE_SIZE, sort: 'created_at', dir: 'desc', search: '' },
    })
  })

  it('reads a page, a size, a sort and a direction', () => {
    const r = parseOrderList(q('page=3&pageSize=10&sort=total&dir=asc'))
    expect(r.ok && r.query).toEqual({
      page: 3, pageSize: 10, sort: 'total', dir: 'asc', search: '',
    })
  })

  it('accepts every sort the list offers', () => {
    for (const sort of ['created_at', 'order_number', 'fulfil_date', 'total']) {
      expect(parseOrderList(q(`sort=${sort}`)).ok).toBe(true)
    }
  })

  // A column not on the list would be interpolated into the query, and an unknown one is a
  // 400 rather than a silent fall back to `created_at`: a list sorted by something other than
  // what was asked for is the same class of bug as a list truncated without saying so.
  it('refuses a sort it does not offer', () => {
    expect(parseOrderList(q('sort=customer_wa'))).toEqual({ ok: false, error: 'invalid_sort' })
    expect(parseOrderList(q('sort=id; drop table orders'))).toEqual({ ok: false, error: 'invalid_sort' })
  })

  it('refuses a direction it does not offer', () => {
    expect(parseOrderList(q('dir=sideways'))).toEqual({ ok: false, error: 'invalid_dir' })
  })

  it('refuses a page that is not a whole number ≥ 1', () => {
    expect(parseOrderList(q('page=0'))).toEqual({ ok: false, error: 'invalid_page' })
    expect(parseOrderList(q('page=-2'))).toEqual({ ok: false, error: 'invalid_page' })
    expect(parseOrderList(q('page=1.5'))).toEqual({ ok: false, error: 'invalid_page' })
    expect(parseOrderList(q('page=all'))).toEqual({ ok: false, error: 'invalid_page' })
  })

  // The bound is REFUSED, not clamped. A clamped page returns fewer rows than the caller asked
  // for, which is exactly the shape of the bug this endpoint is being fixed for (#144).
  it('refuses a page size past the bound rather than clamping it', () => {
    expect(parseOrderList(q(`pageSize=${MAX_ORDERS_PAGE_SIZE}`)).ok).toBe(true)
    expect(parseOrderList(q(`pageSize=${MAX_ORDERS_PAGE_SIZE + 1}`)))
      .toEqual({ ok: false, error: 'invalid_page_size' })
    expect(parseOrderList(q('pageSize=0'))).toEqual({ ok: false, error: 'invalid_page_size' })
    expect(parseOrderList(q('pageSize=99999'))).toEqual({ ok: false, error: 'invalid_page_size' })
  })

  // The bound exists so a page this endpoint agrees to serve is one it can serve WHOLE.
  it('keeps its own bound under PostgREST\'s row cap', () => {
    expect(MAX_ORDERS_PAGE_SIZE).toBeLessThan(1000)
  })

  it('treats an absent parameter as the default, not as a bad one', () => {
    expect(parseOrderList(q('page=&pageSize=')).ok).toBe(true)
  })
})

describe('searchTerm', () => {
  it('passes ordinary names, numbers and order numbers through', () => {
    expect(searchTerm('Ah Meng')).toBe('Ah Meng')
    expect(searchTerm('BT-260728-0050')).toBe('BT-260728-0050')
    expect(searchTerm('+60123456789')).toBe('+60123456789')
  })

  it('strips the characters that would change the query rather than search for them', () => {
    // A comma separates PostgREST's `or` clauses; a dot delimits column.operator.value.
    expect(searchTerm('Ali,Bob')).toBe('Ali Bob')
    expect(searchTerm('name.eq.x')).toBe('name eq x')
    expect(searchTerm('(a)')).toBe('a')
    expect(searchTerm('%')).toBe('')
    expect(searchTerm('a*b')).toBe('a b')
  })

  it('reads nothing as no search at all', () => {
    expect(searchTerm(null)).toBe('')
    expect(searchTerm(undefined)).toBe('')
    expect(searchTerm('   ')).toBe('')
  })
})
