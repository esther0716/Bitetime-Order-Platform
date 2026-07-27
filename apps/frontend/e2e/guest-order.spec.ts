// A guest places a pickup order, end to end.
//
// This is the money path: storefront renders → cart holds a line → the checkout gate lets a
// guest through → the form gates on a real date → POST /api/orders commits inside its
// transaction → the customer is shown the number they will quote when they collect. Every one of
// those is a separate module with its own unit tests; NONE of those tests can tell you the
// pieces are still wired to each other, and a break anywhere in the chain is silent revenue loss.
//
// Selectors are accessible ones (role, label) rather than test ids. That is a deliberate second
// assertion: if `getByLabel('Name')` stops resolving, the field lost its label, and a customer
// using a screen reader lost the field.
import { test, expect } from '@playwright/test'
import { seedShop, serviceClient, SHOP_SLUG, SHOP_NAME, PRODUCT_NAME, ORDER_PREFIX } from './fixtures'

let merchantId: string

test.beforeAll(async () => {
  ;({ merchantId } = await seedShop())
})

test('a guest can place a pickup order and is shown its number', async ({ page }) => {
  await page.goto(`/s/${SHOP_SLUG}`)

  // The shop resolved by slug and the menu loaded. Asserted before anything is clicked so a
  // blank storefront fails HERE, naming itself, rather than as a missing button three steps on.
  await expect(page.getByRole('heading', { name: SHOP_NAME })).toBeVisible()
  await expect(page.getByText(PRODUCT_NAME)).toBeVisible()

  // One of the product. The control is labelled for assistive tech, which is what we address.
  await page.getByRole('button', { name: 'Increase quantity' }).first().click()

  // The gate stands between a signed-out customer and the form. Guest checkout is a first-class
  // path — if this button ever stops working, every customer without an account is blocked.
  await page.getByRole('button', { name: /Continue as guest/ }).click()

  // A date the shop is actually open on. `chosenDate` starts null and the submit gate refuses
  // until it is set, so the first ENABLED cell is the flow's real requirement, not a formality.
  const firstOpenDate = page.locator('[aria-label="Choose a date"] button:not([disabled])').first()
  await expect(firstOpenDate).toBeVisible()
  await firstOpenDate.click()

  await page.getByLabel(/^Name/).fill('Ah Meng')
  await page.getByLabel(/^WhatsApp/).fill('60123456789')

  const placeOrder = page.getByRole('button', { name: 'Place Order' })
  await expect(placeOrder).toBeEnabled() // the submit gate is satisfied
  await placeOrder.click()

  // The success view only renders after the order commits AND notifyOrderPlacedRemote settles.
  await expect(page.getByText('Thank you for your order.')).toBeVisible()

  // The number the customer will quote at collection. Format is customer-visible and pinned:
  // <PREFIX>-YYMMDD-XXXX, and the daily counter starts at 50 rather than 1.
  const shown = await page.locator('strong.font-mono').first().innerText()
  expect(shown).toMatch(new RegExp(`^${ORDER_PREFIX}-\\d{6}-\\d{4}$`))

  // Assert the ORDER, not the screen. A success view proves the browser is happy; only the row
  // proves the transaction committed — and it is the row the shop works from.
  const { data: order, error } = await serviceClient()
    .from('orders')
    .select('order_number, status, customer_name, user_id, total')
    .eq('merchant_id', merchantId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  expect(error).toBeNull()
  expect(order?.order_number).toBe(shown)
  expect(order?.customer_name).toBe('Ah Meng')
  expect(order?.status).toBe('new') // every order is born 'new'; the intake gate says so
  expect(order?.user_id).toBeNull() // a guest carries no account, and must never be attributed one
})
