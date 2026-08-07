/* Measures Poppins against Arial so the metric-fallback @font-face in index.css can
   hold the same line boxes before and after the webfont swap.

   The numbers in index.css MUST come from here, not from taste — a stale size-adjust
   silently reintroduces the layout shift the fallback exists to prevent.

   Run from apps/frontend: node scripts/measure-font-metrics.ts
   (Node strips the types itself; there is no tsx in this workspace.) */
import { chromium } from '@playwright/test'

const SAMPLE = 'Handgloves — the quick brown fox jumps over the lazy dog 0123456789'

const browser = await chromium.launch()
const page = await (await browser.newContext()).newPage()

await page.setContent(`
  <link rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600&display=block">
  <body></body>
`)
/* fonts.check() alone never goes true here: nothing on the page uses the face, so the
   browser never fetches it. load() forces the fetch, then check() confirms it landed. */
await page.evaluate(() => document.fonts.load('400 16px Poppins'))
await page.waitForFunction(() => document.fonts.check('400 16px Poppins'))

const result = await page.evaluate((sample) => {
  const ctx = document.createElement('canvas').getContext('2d')!
  const widthOf = (font: string) => {
    ctx.font = font
    return ctx.measureText(sample).width
  }
  const metricsOf = (font: string) => {
    ctx.font = font
    const m = ctx.measureText(sample)
    return { ascent: m.fontBoundingBoxAscent, descent: m.fontBoundingBoxDescent }
  }
  const real = widthOf('400 1000px Poppins')
  const fallback = widthOf('400 1000px Arial')
  const sizeAdjust = real / fallback
  const { ascent, descent } = metricsOf('400 1000px Poppins')
  return {
    sizeAdjust: +(sizeAdjust * 100).toFixed(2),
    ascentOverride: +((ascent / 1000 / sizeAdjust) * 100).toFixed(2),
    descentOverride: +((descent / 1000 / sizeAdjust) * 100).toFixed(2),
  }
}, SAMPLE)

console.log(`size-adjust: ${result.sizeAdjust}%;`)
console.log(`ascent-override: ${result.ascentOverride}%;`)
console.log(`descent-override: ${result.descentOverride}%;`)

await browser.close()
