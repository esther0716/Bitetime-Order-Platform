// Belt on top of the code path: after the migration's RLS enable-with-no-policies (plus the
// explicit revoke from anon/authenticated), a browser client cannot SELECT releases directly
// at all — mirrors trial-feedback-grant.test.ts. If this ever passes with rows, a policy or
// grant crept in and the backend API is no longer the only door.
import { describe, it, expect } from 'vitest'
import { anonClient, makeUser, serviceClient } from './helpers.js'

describe('releases is not directly readable by the browser', () => {
  it('denies an anonymous SELECT', async () => {
    const { data, error } = await anonClient().from('releases').select('*')
    expect(error !== null || (data ?? []).length === 0).toBe(true)
    if (error) expect(error.message.toLowerCase()).toContain('permission denied')
  })

  it('denies an authenticated SELECT', async () => {
    const user = await makeUser('releases-grant-user@example.com', 'password123')
    const svc = serviceClient()
    await svc.from('releases').insert({
      tag: 'releases-grant-test-tag',
      name: 'Test release',
      html_url: 'https://github.com/leongcheefai/Bitetime-Order-Platform/releases/tag/releases-grant-test-tag',
      raw_body: 'raw body',
      published_at: new Date().toISOString(),
    })

    const { data, error } = await user.from('releases').select('*').eq('tag', 'releases-grant-test-tag')

    expect(error).not.toBeNull()
    expect(error?.code === '42501' || error?.message.toLowerCase().includes('permission denied')).toBe(true)
    expect(data).toBeNull()
  })
})
