import { describe, it, expect } from 'vitest'
import { buildTrialFeedbackEmail } from '../../src/trialFeedbackEmail.js'

describe('buildTrialFeedbackEmail', () => {
  it('names the shop in the subject and links to the dashboard', () => {
    const { subject, text } = buildTrialFeedbackEmail({
      shopName: 'Kopi Corner',
      dashboardUrl: 'https://tinyorder.vercel.app/merchant',
    })
    expect(subject).toContain('Kopi Corner')
    expect(text).toContain('Kopi Corner')
    expect(text).toContain('https://tinyorder.vercel.app/merchant')
  })
})
