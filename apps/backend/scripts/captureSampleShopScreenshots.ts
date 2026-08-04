// CI-only. Never imported by src/app.ts, never bundled by the esbuild build — playwright stays
// a devDependency, not a runtime one. Run via `pnpm --filter @bitetime/backend screenshot:sweep`
// (plain `node --experimental-strip-types`, NOT the `--import jiti/register` the rest of the
// backend uses for dev — jiti's module transform breaks playwright-core's bundled `node:os`
// interop, throwing `Cannot read properties of undefined (reading 'join')` on import), scheduled
// weekly by .github/workflows/sample-shop-screenshot-sweep.yml.
import { chromium } from 'playwright'

const FRONTEND_URL = process.env.FRONTEND_URL
const BACKEND_URL = process.env.BACKEND_URL
const SWEEP_SECRET = process.env.SAMPLE_SHOP_SCREENSHOT_SWEEP_SECRET
if (!FRONTEND_URL || !BACKEND_URL || !SWEEP_SECRET) {
  console.error('FRONTEND_URL, BACKEND_URL and SAMPLE_SHOP_SCREENSHOT_SWEEP_SECRET are all required')
  process.exit(1)
}

interface SampleShop {
  id: string
  slug: string
}

async function main() {
  const res = await fetch(`${BACKEND_URL}/api/merchants/samples`)
  if (!res.ok) throw new Error(`GET /api/merchants/samples: ${res.status}`)
  const shops = (await res.json()) as SampleShop[]

  const browser = await chromium.launch()
  // Mobile viewport — this storefront is mobile-first, and the card the screenshot lands in is
  // a narrow, portrait-shaped slot.
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })

  let okCount = 0
  for (const shop of shops) {
    try {
      // Exactly two Playwright calls: navigate, screenshot. No click(), no form interaction,
      // anywhere in this script — that is what makes this incapable of placing a real order.
      await page.goto(`${FRONTEND_URL}/s/${shop.slug}`, { waitUntil: 'networkidle' })
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
      // One shop's capture failing (a redirect, a slow load, a temporary 5xx) must not stop the
      // rest — the card's fallback layout is exactly what makes a missed capture harmless.
      console.error(`capture failed for ${shop.slug}:`, err instanceof Error ? err.message : String(err))
    }
  }

  await browser.close()
  console.log(`captured ${okCount}/${shops.length}`)
}

main()
