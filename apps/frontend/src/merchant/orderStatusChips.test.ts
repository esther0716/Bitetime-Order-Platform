import { describe, it, expect } from 'vitest'
import { statusChips } from './orderStatusChips'

describe('statusChips', () => {
  it('leads with an all-orders chip that totals every status', () => {
    expect(statusChips({ new: 2, completed: 5 }, '')[0]).toEqual({ status: '', count: 7 })
  })

  it('draws only the statuses the shop has orders in, in working order', () => {
    expect(statusChips({ completed: 5, new: 2, cancelled: 1 }, '').slice(1)).toEqual([
      { status: 'new', count: 2 },
      { status: 'completed', count: 5 },
      { status: 'cancelled', count: 1 },
    ])
  })

  it('keeps the selected chip even once its last order moves on', () => {
    // Otherwise the filter stays on with nothing on screen able to turn it off.
    expect(statusChips({ completed: 3 }, 'ready')).toContainEqual({ status: 'ready', count: 0 })
  })

  it('counts a status it has not been taught into the total, but draws no chip for it', () => {
    const chips = statusChips({ new: 1, refunded: 4 }, '')
    expect(chips[0]).toEqual({ status: '', count: 5 })
    expect(chips.map(c => c.status)).toEqual(['', 'new'])
  })

  it('reads counts it does not have yet as an empty tally', () => {
    expect(statusChips(null, '')).toEqual([{ status: '', count: 0 }])
  })
})
