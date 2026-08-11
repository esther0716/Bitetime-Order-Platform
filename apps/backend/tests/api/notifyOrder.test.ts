// tests/api/notifyOrder.test.ts
// POST /api/notify/order — the post-commit notification fan-out, driven in-process
// against real Postgres via app.request().
//
// The two properties this suite exists to prove cannot be faked and are only real
// against Postgres:
//
//   * ONE-SHOT — confirmation_emailed_at is an atomic null→now() claim. A second
//     call for the same order sends NO second email. A mocked DB would report green
//     while proving nothing about the row lock.
//   * RECIPIENT FROM THE ACCOUNT — the address is read from the order's user_id via
//     Auth, never from the request body. A guest order (user_id null) is excluded
//     structurally, not by a droppable conditional.
//
// Only the outbound adapters are faked (via the exported `notifyDeps` seam) so no
// live email/Telegram network is touched; the database is never mocked.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { app, notifyDeps } from '../../src/app.js'
import { makeUser, resetMerchant, seedMerchant, seedProduct, serviceClient } from '../rls/helpers.js'
import { todayInZone, DEFAULT_TIMEZONE } from '@bitetime/shared'

/**
 * The pre-options cart shape, as a list. This suite's assertions predate menu options and are the
 * record of what intake already promised, so the shape is migrated and nothing else moves.
 */
const asCart = (c: Record<string, number>) =>
  Object.entries(c).map(([productId, qty]) => ({ productId, qty, selections: [] }))


const SLUG = 'notify-shop'
const CUSTOMER_EMAIL = 'notify-customer@test.dev'
const OWNER_EMAIL = 'notify-owner@test.dev'

const svc = () => serviceClient()

/** A date the default fulfilment config is certainly taking: today + 1, on the shop's clock. */
function tomorrowInShopZone(): string {
  const today = todayInZone(DEFAULT_TIMEZONE, new Date())
  const d = new Date(`${today}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

function orderBody(merchantId: string, productId: string, extra: Record<string, unknown> = {}) {
  return {
    merchantId,
    customerName: 'Ah Meng',
    customerWa: '60123456789',
    mode: 'pickup',
    cart: asCart({ [productId]: 2 }),
    quotedTotal: 26,
    fulfilDate: tomorrowInShopZone(),
    ...extra,
  }
}

function postOrder(payload: unknown, token?: string) {
  return app.request('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(payload),
  })
}

function postNotify(payload: unknown) {
  return app.request('/api/notify/order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

async function placeOrderReturningNumber(payload: unknown, token?: string): Promise<string> {
  const res = await postOrder(payload, token)
  const json = (await res.json()) as { orderNumber?: string; error?: string }
  if (!json.orderNumber) throw new Error(`order intake failed: ${json.error ?? res.status}`)
  return json.orderNumber
}

// Captured outbound mail. The Telegram adapter is a no-op success unless a test
// overrides it. Both are restored after the suite.
//
// ONE fake adapter now serves two email arms — the customer's receipt and the shop owner's
// new-order alert — so every assertion here filters by RECIPIENT rather than counting the
// array. A bare `toHaveLength(1)` would silently start meaning "one of the two", which is the
// exact confusion the two arms exist to keep apart.
type Sent = { to: string; subject: string; body: { text: string; html?: string; from?: string } }
let sentEmails: Sent[]
const origEmail = notifyDeps.email
const origTelegram = notifyDeps.telegram

const mailTo = (addr: string) => sentEmails.filter((e) => e.to === addr)

let merchantId: string
let productId: string
let customerToken: string

describe('POST /api/notify/order — customer confirmation email fan-out', () => {
  beforeAll(async () => {
    const owner = await makeUser(OWNER_EMAIL, 'password123')
    const ownerId = (await owner.auth.getUser()).data.user!.id
    merchantId = await seedMerchant({ slug: SLUG, owner_id: ownerId, name: 'Notify Shop' })
    productId = await seedProduct({ merchant_id: merchantId, price: 13 })

    const customer = await makeUser(CUSTOMER_EMAIL, 'password123')
    customerToken = (await customer.auth.getSession()).data.session!.access_token
  })

  afterAll(async () => {
    notifyDeps.email = origEmail
    notifyDeps.telegram = origTelegram
    await resetMerchant(SLUG)
  })

  beforeEach(() => {
    sentEmails = []
    notifyDeps.email = async (to, subject, body) => { sentEmails.push({ to, subject, body }) }
    notifyDeps.telegram = async () => {} // no-op success (a Telegram secret is seeded below per-test)
  })

  it('sends exactly one email, to the account address, for a signed-in customer', async () => {
    const orderNumber = await placeOrderReturningNumber(orderBody(merchantId, productId), customerToken)

    const res = await postNotify({ merchantId, orderNumber, lang: 'en' })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { email: { ok: boolean } }
    expect(json.email.ok).toBe(true)

    const mail = mailTo(CUSTOMER_EMAIL)
    expect(mail).toHaveLength(1)
    expect(mail[0].subject).toContain(orderNumber)
    expect(mail[0].body.html).toBeTruthy()
    expect(mail[0].body.from).toContain('Notify Shop')
  })

  it('sends NO email for a guest order (user_id null), and does not error', async () => {
    const orderNumber = await placeOrderReturningNumber(orderBody(merchantId, productId)) // no token ⇒ guest

    const res = await postNotify({ merchantId, orderNumber, lang: 'en' })
    const json = (await res.json()) as { email: { ok: boolean; skipped?: boolean } }
    expect(json.email.ok).toBe(true)
    expect(json.email.skipped).toBe(true)
    expect(mailTo(CUSTOMER_EMAIL)).toHaveLength(0)
  })

  it('sends at most one email across repeated calls (dedup via confirmation_emailed_at)', async () => {
    const orderNumber = await placeOrderReturningNumber(orderBody(merchantId, productId), customerToken)

    await postNotify({ merchantId, orderNumber, lang: 'en' })
    const second = await postNotify({ merchantId, orderNumber, lang: 'en' })
    const json = (await second.json()) as { email: { ok: boolean; skipped?: boolean } }
    expect(json.email.skipped).toBe(true)
    expect(mailTo(CUSTOMER_EMAIL)).toHaveLength(1)
  })

  // The other half of the dedup rule. "At most one" is only half a contract: a claim stamped
  // BEFORE the send is spent whether or not the mail left, so one Resend blip would retire the
  // receipt permanently and no retry could ever deliver it. The claim must survive a failure.
  it('a failed send leaves the claim unspent — a retry still delivers the receipt', async () => {
    notifyDeps.email = async () => { throw new Error('resend down') }
    const orderNumber = await placeOrderReturningNumber(orderBody(merchantId, productId), customerToken)

    const first = await postNotify({ merchantId, orderNumber, lang: 'en' })
    expect(((await first.json()) as { email: { ok: boolean } }).email.ok).toBe(false)

    // Resend recovers.
    notifyDeps.email = async (to, subject, body) => { sentEmails.push({ to, subject, body }) }
    const second = await postNotify({ merchantId, orderNumber, lang: 'en' })
    const json = (await second.json()) as { email: { ok: boolean; skipped?: boolean } }

    expect(json.email.ok).toBe(true)
    expect(json.email.skipped).toBeUndefined() // not "already emailed" — it never was
    expect(mailTo(CUSTOMER_EMAIL)).toHaveLength(1)
  })

  it('never takes the recipient from the request body', async () => {
    const orderNumber = await placeOrderReturningNumber(orderBody(merchantId, productId), customerToken)

    await postNotify({ merchantId, orderNumber, lang: 'en', email: 'attacker@evil.com', to: 'attacker@evil.com' })
    expect(mailTo(CUSTOMER_EMAIL)).toHaveLength(1)
    expect(mailTo('attacker@evil.com')).toHaveLength(0)
  })

  it('a Telegram failure does not suppress the customer email', async () => {
    // Seed a Telegram secret so notifyOrderPlaced actually attempts a send, then make it throw.
    await svc().from('merchant_secrets').upsert({ merchant_id: merchantId, tg_token: 't0ken', tg_chat_id: '42' })
    notifyDeps.telegram = async () => { throw new Error('telegram down') }

    const orderNumber = await placeOrderReturningNumber(orderBody(merchantId, productId), customerToken)
    const res = await postNotify({ merchantId, orderNumber, lang: 'en' })
    const json = (await res.json()) as { telegram: { ok: boolean }; email: { ok: boolean } }

    expect(json.telegram.ok).toBe(false)
    expect(json.email.ok).toBe(true)
    expect(mailTo(CUSTOMER_EMAIL)).toHaveLength(1)

    await svc().from('merchant_secrets').delete().eq('merchant_id', merchantId)
  })

  it('an email failure does not suppress the merchant Telegram', async () => {
    await svc().from('merchant_secrets').upsert({ merchant_id: merchantId, tg_token: 't0ken', tg_chat_id: '42' })
    let telegramSent = 0
    notifyDeps.telegram = async () => { telegramSent++ }
    notifyDeps.email = async () => { throw new Error('resend down') }

    const orderNumber = await placeOrderReturningNumber(orderBody(merchantId, productId), customerToken)
    const res = await postNotify({ merchantId, orderNumber, lang: 'en' })
    const json = (await res.json()) as { telegram: { ok: boolean }; email: { ok: boolean } }

    expect(json.telegram.ok).toBe(true)
    expect(telegramSent).toBe(1)
    expect(json.email.ok).toBe(false)

    await svc().from('merchant_secrets').delete().eq('merchant_id', merchantId)
  })
})

// ── The third arm ─────────────────────────────────────────────────────────────
// The shop owner's new-order email. It exists because Telegram is opt-in: a shop that never set
// a bot up had no notification at all and learned of an order by refreshing the dashboard.
// Its OWN shop, owner and customer — not the suite above's. `makeUser` deletes and recreates,
// so sharing a slug or an email would make the two suites order-dependent, and an order-
// dependent DB suite fails in whichever order CI happens to pick.
const M_SLUG = 'notify-merchant-shop'
const M_OWNER_EMAIL = 'notify-merchant-owner@test.dev'
const M_CUSTOMER_EMAIL = 'notify-merchant-customer@test.dev'

describe('POST /api/notify/order — merchant new-order email fan-out', () => {
  let mMerchantId: string
  let mProductId: string
  let mCustomerToken: string

  beforeAll(async () => {
    const owner = await makeUser(M_OWNER_EMAIL, 'password123')
    const ownerId = (await owner.auth.getUser()).data.user!.id
    mMerchantId = await seedMerchant({ slug: M_SLUG, owner_id: ownerId, name: 'Merchant Mail Shop' })
    mProductId = await seedProduct({ merchant_id: mMerchantId, price: 13 })

    const customer = await makeUser(M_CUSTOMER_EMAIL, 'password123')
    mCustomerToken = (await customer.auth.getSession()).data.session!.access_token
  })

  afterAll(async () => {
    notifyDeps.email = origEmail
    notifyDeps.telegram = origTelegram
    await resetMerchant(M_SLUG)
  })

  beforeEach(() => {
    sentEmails = []
    notifyDeps.email = async (to, subject, body) => { sentEmails.push({ to, subject, body }) }
    notifyDeps.telegram = async () => {}
  })

  it('emails the owner of a shop with no Telegram — the arm that used to have nothing', async () => {
    const orderNumber = await placeOrderReturningNumber(orderBody(mMerchantId, mProductId), mCustomerToken)

    const res = await postNotify({ merchantId: mMerchantId, orderNumber, lang: 'en' })
    const json = (await res.json()) as {
      telegram: { ok: boolean; skipped?: boolean }
      merchantEmail: { ok: boolean }
    }
    expect(json.telegram.skipped).toBe(true) // no token configured
    expect(json.merchantEmail.ok).toBe(true)

    const mail = mailTo(M_OWNER_EMAIL)
    expect(mail).toHaveLength(1)
    expect(mail[0].subject).toContain(orderNumber)
    expect(mail[0].body.html).toBeTruthy()
  })

  it('emails the owner AS WELL AS its Telegram — the two are channels, not alternatives', async () => {
    await svc().from('merchant_secrets').upsert({ merchant_id: mMerchantId, tg_token: 't0ken', tg_chat_id: '42' })
    let telegramSent = 0
    notifyDeps.telegram = async () => { telegramSent++ }

    const orderNumber = await placeOrderReturningNumber(orderBody(mMerchantId, mProductId), mCustomerToken)
    const res = await postNotify({ merchantId: mMerchantId, orderNumber, lang: 'en' })
    const json = (await res.json()) as { telegram: { ok: boolean }; merchantEmail: { ok: boolean } }

    expect(json.telegram.ok).toBe(true)
    expect(telegramSent).toBe(1)
    expect(json.merchantEmail.ok).toBe(true)
    expect(mailTo(M_OWNER_EMAIL)).toHaveLength(1)
    await svc().from('merchant_secrets').delete().eq('merchant_id', mMerchantId)
  })

  it('emails the owner for a GUEST order too — the shop must learn of it either way', async () => {
    const orderNumber = await placeOrderReturningNumber(orderBody(mMerchantId, mProductId)) // no token

    const res = await postNotify({ merchantId: mMerchantId, orderNumber, lang: 'en' })
    const json = (await res.json()) as {
      email: { skipped?: boolean }
      merchantEmail: { ok: boolean }
    }
    expect(json.email.skipped).toBe(true) // the guest has no account to receive a receipt
    expect(json.merchantEmail.ok).toBe(true)
    expect(mailTo(M_OWNER_EMAIL)).toHaveLength(1)
  })

  it('sends at most one owner email across repeated calls (dedup via merchant_emailed_at)', async () => {
    const orderNumber = await placeOrderReturningNumber(orderBody(mMerchantId, mProductId), mCustomerToken)

    await postNotify({ merchantId: mMerchantId, orderNumber })
    const second = await postNotify({ merchantId: mMerchantId, orderNumber })
    const json = (await second.json()) as { merchantEmail: { ok: boolean; skipped?: boolean } }
    expect(json.merchantEmail.skipped).toBe(true)
    // The claim is what keeps an anonymous endpoint from being a mail flood at a guessable
    // order number. Only real against Postgres.
    expect(mailTo(M_OWNER_EMAIL)).toHaveLength(1)
  })

  // Same rule as the customer arm, and it bites harder here: a basic shop has no Telegram, so
  // this mail is the ONLY way it learns an order exists. A claim spent on a failed send is an
  // order the shop never hears about.
  it('a failed send leaves the claim unspent — a retry still delivers the owner alert', async () => {
    notifyDeps.email = async () => { throw new Error('resend down') }
    const orderNumber = await placeOrderReturningNumber(orderBody(mMerchantId, mProductId), mCustomerToken)

    const first = await postNotify({ merchantId: mMerchantId, orderNumber })
    expect(((await first.json()) as { merchantEmail: { ok: boolean } }).merchantEmail.ok).toBe(false)

    notifyDeps.email = async (to, subject, body) => { sentEmails.push({ to, subject, body }) }
    const second = await postNotify({ merchantId: mMerchantId, orderNumber })
    const json = (await second.json()) as { merchantEmail: { ok: boolean; skipped?: boolean } }

    expect(json.merchantEmail.ok).toBe(true)
    expect(json.merchantEmail.skipped).toBeUndefined()
    expect(mailTo(M_OWNER_EMAIL)).toHaveLength(1)
  })

  it('takes the owner address from the shop, never from the request body', async () => {
    const orderNumber = await placeOrderReturningNumber(orderBody(mMerchantId, mProductId), mCustomerToken)

    await postNotify({ merchantId: mMerchantId, orderNumber, email: 'attacker@evil.com', to: 'attacker@evil.com' })
    expect(mailTo(M_OWNER_EMAIL)).toHaveLength(1)
    expect(mailTo('attacker@evil.com')).toHaveLength(0)
  })

  it('sends from the PLATFORM address, not the shop-named sender the customer receipt wears', async () => {
    const orderNumber = await placeOrderReturningNumber(orderBody(mMerchantId, mProductId), mCustomerToken)

    await postNotify({ merchantId: mMerchantId, orderNumber, lang: 'en' })
    // The shop is the RECIPIENT here; an alert appearing to come from itself reads as a copy of
    // the customer's receipt — which is exactly what the customer's own mail does wear.
    expect(mailTo(M_OWNER_EMAIL)[0].body.from).not.toContain('Merchant Mail Shop')
    expect(mailTo(M_CUSTOMER_EMAIL)[0].body.from).toContain('Merchant Mail Shop')
  })

  it('is English regardless of the language the customer ordered in', async () => {
    const orderNumber = await placeOrderReturningNumber(orderBody(mMerchantId, mProductId), mCustomerToken)

    await postNotify({ merchantId: mMerchantId, orderNumber, lang: 'zh' })
    const owner = mailTo(M_OWNER_EMAIL)[0]
    expect(owner.subject).toMatch(/^New order /)
    expect(owner.body.text).not.toMatch(/[一-鿿]/)
    // …while the customer, who ordered in Chinese, is answered in Chinese.
    expect(mailTo(M_CUSTOMER_EMAIL)[0].subject).toContain('订单')
  })

  it('carries the operational detail the customer receipt omits', async () => {
    const orderNumber = await placeOrderReturningNumber(orderBody(mMerchantId, mProductId), mCustomerToken)

    await postNotify({ merchantId: mMerchantId, orderNumber })
    const owner = mailTo(M_OWNER_EMAIL)[0].body.text
    expect(owner).toContain('60123456789') // the customer's WhatsApp — the shop's way to reach them
    expect(owner).toContain('/merchant') // straight to the dashboard
    // The customer's own receipt never carries their number back to them.
    expect(mailTo(M_CUSTOMER_EMAIL)[0].body.text).not.toContain('60123456789')
  })

  // An owner whose ACCOUNT is gone is not a case that can arise: merchants.owner_id carries a
  // plain `references auth.users (id)` with no cascade, so Postgres refuses to delete an account
  // that still owns a shop. Two reachable unreachable-owners remain, and both are covered here.
  it('skips (without erroring) when the shop has no owner to email', async () => {
    const owner = await makeUser('notify-ownerless@test.dev', 'password123')
    const ownerId = (await owner.auth.getUser()).data.user!.id
    const ownerless = await seedMerchant({ slug: 'notify-ownerless', owner_id: ownerId, name: 'Ownerless Shop' })
    const ownerlessProduct = await seedProduct({ merchant_id: ownerless, price: 13 })
    const orderNumber = await placeOrderReturningNumber(orderBody(ownerless, ownerlessProduct))
    await svc().from('merchants').update({ owner_id: null }).eq('id', ownerless)

    const res = await postNotify({ merchantId: ownerless, orderNumber })
    const json = (await res.json()) as { merchantEmail: { ok: boolean; skipped?: boolean } }
    expect(json.merchantEmail.ok).toBe(true)
    expect(json.merchantEmail.skipped).toBe(true)
    expect(sentEmails).toHaveLength(0)

    // And the one-shot stamp is left UNCLAIMED: a shop unreachable at this moment must not lose
    // that order's alert forever. This is why the owner is resolved before the claim.
    const { data } = await svc()
      .from('orders').select('merchant_emailed_at')
      .eq('merchant_id', ownerless).eq('order_number', orderNumber).maybeSingle()
    expect(data?.merchant_emailed_at).toBeNull()

    await resetMerchant('notify-ownerless')
  })

  it('skips when the owner account carries no address at all', async () => {
    // A phone-only signup reads back `email: ''` from Auth — falsy, so there is nothing to send
    // to even though the account plainly exists.
    const { data: created } = await svc().auth.admin.createUser({
      phone: '+60123400002', password: 'password123', phone_confirm: true,
    })
    const phoneOnlyId = created!.user!.id
    const shop = await seedMerchant({ slug: 'notify-phone-owner', owner_id: phoneOnlyId, name: 'Phone Owner Shop' })
    const shopProduct = await seedProduct({ merchant_id: shop, price: 13 })
    const orderNumber = await placeOrderReturningNumber(orderBody(shop, shopProduct))

    const res = await postNotify({ merchantId: shop, orderNumber })
    const json = (await res.json()) as { merchantEmail: { ok: boolean; skipped?: boolean } }
    expect(json.merchantEmail.ok).toBe(true)
    expect(json.merchantEmail.skipped).toBe(true)
    expect(sentEmails).toHaveLength(0)

    await resetMerchant('notify-phone-owner')
    await svc().auth.admin.deleteUser(phoneOnlyId)
  })

  it('a merchant-email failure does not suppress the customer receipt or Telegram', async () => {
    await svc().from('merchant_secrets').upsert({ merchant_id: mMerchantId, tg_token: 't0ken', tg_chat_id: '42' })
    let telegramSent = 0
    notifyDeps.telegram = async () => { telegramSent++ }
    // Only the owner's send throws; the customer's goes through the same adapter and must not.
    notifyDeps.email = async (to, subject, body) => {
      if (to === M_OWNER_EMAIL) throw new Error('resend down')
      sentEmails.push({ to, subject, body })
    }

    const orderNumber = await placeOrderReturningNumber(orderBody(mMerchantId, mProductId), mCustomerToken)
    const res = await postNotify({ merchantId: mMerchantId, orderNumber, lang: 'en' })
    const json = (await res.json()) as {
      telegram: { ok: boolean }
      email: { ok: boolean }
      merchantEmail: { ok: boolean }
    }

    expect(json.merchantEmail.ok).toBe(false)
    expect(json.email.ok).toBe(true)
    expect(json.telegram.ok).toBe(true)
    expect(telegramSent).toBe(1)
    expect(mailTo(M_CUSTOMER_EMAIL)).toHaveLength(1)
    await svc().from('merchant_secrets').delete().eq('merchant_id', mMerchantId)
  })

  it('survives the OTHER two arms failing — a Telegram outage and a dead customer receipt', async () => {
    // The mirror of the test above: the merchant's alert is the arm every shop depends on, so it
    // must be the one that still lands when its neighbours are down.
    await svc().from('merchant_secrets').upsert({ merchant_id: mMerchantId, tg_token: 't0ken', tg_chat_id: '42' })
    notifyDeps.telegram = async () => { throw new Error('telegram down') }
    notifyDeps.email = async (to, subject, body) => {
      if (to === M_CUSTOMER_EMAIL) throw new Error('resend down')
      sentEmails.push({ to, subject, body })
    }

    const orderNumber = await placeOrderReturningNumber(orderBody(mMerchantId, mProductId), mCustomerToken)
    const res = await postNotify({ merchantId: mMerchantId, orderNumber, lang: 'en' })
    const json = (await res.json()) as {
      telegram: { ok: boolean }
      email: { ok: boolean }
      merchantEmail: { ok: boolean }
    }

    expect(json.telegram.ok).toBe(false)
    expect(json.email.ok).toBe(false)
    expect(json.merchantEmail.ok).toBe(true)
    expect(mailTo(M_OWNER_EMAIL)).toHaveLength(1)
    await svc().from('merchant_secrets').delete().eq('merchant_id', mMerchantId)
  })

  it('404s only when the order does not exist — every arm agrees', async () => {
    const res = await postNotify({ merchantId: mMerchantId, orderNumber: 'NO-SUCH-ORDER' })
    expect(res.status).toBe(404)
    expect(sentEmails).toHaveLength(0)
  })
})
