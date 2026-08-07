// The marketing pages' CTA and section-heading class strings.
//
// Lifted out of Landing.tsx when /pricing became its own page (#169): a "Start your shop" button
// that is a different size on the pricing page than on the landing page is the kind of drift
// nobody files a bug about and everybody sees.

import { cn } from '../lib/utils'

export const ctaPrimary =
  'inline-block py-[13px] px-7 bg-primary text-background rounded-md text-[15px] font-medium font-sans no-underline [transition:background_0.15s,transform_0.15s] hover:bg-brand-600 hover:-translate-y-px'

export const ctaGhost =
  'inline-block py-3 px-[26px] border-[0.5px] border-border rounded-md text-[15px] font-medium font-sans text-ink-700 no-underline [transition:border-color_0.15s,color_0.15s] hover:border-primary hover:text-primary'

/** Inside a flex-col card: push to the bottom edge and centre the label. */
export const cardCtaPrimary = cn(ctaPrimary, 'mt-auto text-center')
export const cardCtaGhost = cn(ctaGhost, 'mt-auto text-center')

/** Section heading (Steps, Pricing, and the /pricing page's sections share it). */
export const sectionTitle = 'font-heading text-2xl font-medium text-foreground text-center mb-10'
