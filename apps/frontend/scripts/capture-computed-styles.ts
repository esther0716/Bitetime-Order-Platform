/* Snapshots the RESOLVED colour and geometry of every element on a set of routes.
   Run before a token rename and after it: an identical pair of files is the proof that a
   sweep across hundreds of call sites changed no pixel. Compare with `diff`.

   This is the gate for the rename PR. It is only meaningful if the rename is genuinely
   inert — anything that changes a computed value (e.g. swapping Tailwind's `rounded-full`,
   which is calc(infinity*1px), for `--radius-pill`'s 9999px) belongs in a different PR.

   Run from apps/frontend, against a built preview server:
     pnpm build && pnpm preview &
     node scripts/capture-computed-styles.ts /tmp/styles-before.txt */
import { chromium } from '@playwright/test'
import { writeFileSync } from 'node:fs'

const ORIGIN = process.env.ORIGIN ?? 'http://localhost:4173'
const ROUTES = ['/', '/pricing', '/features', '/faq', '/sample-shops', '/merchant/login', '/merchant/signup']
const OUT = process.argv[2]
if (!OUT) throw new Error('usage: capture-computed-styles.ts <output-file>')

/* `opacity` is deliberately NOT captured. One storefront element animates on a setInterval
   that prefers-reduced-motion does not reach, so its opacity is still mid-interpolation at
   snapshot time and differs run to run. No token drives opacity — the disabled state is a
   colour pair, by design — so capturing it buys nothing and costs determinism, and a gate
   that fails at random is worse than one scoped to what tokens actually control. */
const PROPS = [
  'color', 'backgroundColor', 'borderTopColor', 'borderTopWidth',
  'borderRadius', 'boxShadow', 'fontFamily', 'fontSize', 'fontWeight',
] as const

const browser = await chromium.launch()
/* `reducedMotion` rather than a CSS override. Motion drives entrance animations through the
   Web Animations API, not CSS animations, so injecting `animation:none` does not stop them —
   a first run caught opacity mid-interpolation (0.999564) and a second caught it elsewhere
   (0.998914), which would have made every diff a false failure. This flag routes through the
   app's own `useReducedMotion` / prefers-reduced-motion handling, so entrances land on their
   resting values immediately. */
const page = await (await browser.newContext({
  viewport: { width: 1280, height: 900 },
  reducedMotion: 'reduce',
})).newPage()
const lines: string[] = []

for (const route of ROUTES) {
  await page.goto(`${ORIGIN}${route}`, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(400)

  const rows = await page.evaluate((props) => {
    const out: string[] = []
    document.querySelectorAll('*').forEach((el, i) => {
      const cs = getComputedStyle(el)
      out.push(`${i}\t${el.tagName}\t` + props.map((p) => cs[p as never]).join('\t'))
    })
    return out
  }, PROPS as unknown as string[])

  lines.push(`### ${route}`, ...rows)
}

writeFileSync(OUT, lines.join('\n'))
await browser.close()
console.log(`wrote ${lines.length} lines to ${OUT}`)
