// CI-only. Never imported by src/app.ts, never bundled by the esbuild build — playwright stays
// a devDependency, not a runtime one. Run via `pnpm --filter @bitetime/backend screenshot:sweep`
// (plain `node --experimental-strip-types`, NOT the `--import jiti/register` the rest of the
// backend uses for dev — jiti's module transform breaks playwright-core's bundled `node:os`
// interop, throwing `Cannot read properties of undefined (reading 'join')` on import), scheduled
// weekly by .github/workflows/sample-shop-screenshot-sweep.yml.
import { chromium, type Page } from 'playwright'

const FRONTEND_URL = process.env.FRONTEND_URL
const BACKEND_URL = process.env.BACKEND_URL
const SWEEP_SECRET = process.env.SAMPLE_SHOP_SCREENSHOT_SWEEP_SECRET
// Set by the workflow's `merchant_id` dispatch input — one shop, captured the moment a
// superadmin flags it. Empty (the schedule, and the manual "Run workflow" button) sweeps all.
const MERCHANT_ID = (process.env.MERCHANT_ID || '').trim()
if (!FRONTEND_URL || !BACKEND_URL || !SWEEP_SECRET) {
  console.error('FRONTEND_URL, BACKEND_URL and SAMPLE_SHOP_SCREENSHOT_SWEEP_SECRET are all required')
  process.exit(1)
}

interface SampleShop {
  id: string
  slug: string
}

// The storefront reads its shop and products AFTER mount, so `load` fires on a page that has no
// shop on it yet — the marker is the proof a menu is actually on screen. Kept in sync with
// `data-sample-capture="menu"` in apps/frontend/src/store/Storefront.tsx.
const MENU_MARKER = '[data-sample-capture="menu"]'
const NAV_TIMEOUT_MS = 30_000

// `?preview=1` renders the shop without the order form — see the rule it drives in
// apps/frontend/src/index.css. Without it a 390x844 capture is mostly sign-in links, a language
// picker and an empty calendar, which is what visitors were complaining about.
async function openStorefront(page: Page, slug: string): Promise<void> {
  await page.goto(`${FRONTEND_URL}/s/${slug}?preview=1`, { waitUntil: 'load', timeout: NAV_TIMEOUT_MS })
  await page.waitForSelector(MENU_MARKER, { timeout: NAV_TIMEOUT_MS })
}

// One retry only. The failure this exists for is a cold start on the frontend or the backend,
// which does not repeat; anything that fails twice is a real fault and should be reported as one.
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch {
    return await fn()
  }
}

async function main() {
  const res = await fetch(`${BACKEND_URL}/api/merchants/samples`)
  if (!res.ok) throw new Error(`GET /api/merchants/samples: ${res.status}`)
  const all = (await res.json()) as SampleShop[]
  const shops = MERCHANT_ID ? all.filter((s) => s.id === MERCHANT_ID) : all
  // A dispatch naming a shop that is not a sample is a real error, not an empty sweep: the
  // admin who flagged it is waiting for a card that would never appear.
  if (MERCHANT_ID && shops.length === 0) {
    throw new Error(`merchant ${MERCHANT_ID} is not an active sample shop`)
  }

  const browser = await chromium.launch()
  // 390 wide because the storefront is mobile-first; 520 tall because that is 390 at the card's
  // own 3:4 (SampleShopsCarousel). A full 844-tall phone viewport is cropped to this anyway, and
  // in `?preview=1` — which ends after the menu — the rest of it is empty page.
  const page = await browser.newPage({ viewport: { width: 390, height: 520 } })

  let okCount = 0
  const failed: string[] = []
  for (const shop of shops) {
    try {
      // Exactly two kinds of Playwright call: navigate, screenshot. No click(), no form
      // interaction, anywhere in this script — that is what makes this incapable of placing a
      // real order.
      //
      // `networkidle` never settled reliably here — the storefront keeps talking to the backend.
      // openStorefront waits for the menu marker instead, which is what "there is a shop on
      // screen" actually means.
      await withRetry(() => openStorefront(page, shop.slug))
      const pngBuffer = await page.screenshot({ type: 'png' })

      const upload = await fetch(
        `${BACKEND_URL}/api/internal/sample-shop-screenshot/${shop.id}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'image/png', 'x-sweep-secret': SWEEP_SECRET },
          body: pngBuffer,
        },
      )
      if (!upload.ok) throw new Error(`upload: ${upload.status}`)
      okCount++
    } catch (err) {
      // One shop's failure must not stop the rest — but it must not pass silently either. The
      // carousel now shows only shops that HAVE a screenshot, so a missed capture is a shop
      // missing from the page, and a green run that captured nothing is how that went unnoticed
      // for a week. Collected here, exited non-zero below.
      failed.push(shop.slug)
      console.error(`capture failed for ${shop.slug}:`, err instanceof Error ? err.message : String(err))
    }
  }

  await browser.close()
  console.log(`captured ${okCount}/${shops.length}`)
  if (failed.length > 0) throw new Error(`capture failed for: ${failed.join(', ')}`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
