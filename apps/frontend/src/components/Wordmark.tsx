import logo from '../assets/tinyorder-logo.png'
import logo2x from '../assets/tinyorder-logo@2x.png'
import { cn } from '@/lib/utils'

// The TinyOrder brand lockup — receipt mark + serif wordmark.
// Everywhere the app used to render the bare string "TinyOrder" in Lora now
// renders this instead, so the brand only has to be corrected in one place.
// Size it with a height class (`h-7`, `h-[26px]`); width follows the ratio.
//
// THE ASSETS ARE SIZED TO WHAT IS RENDERED, which is the only reason they are
// small. The tallest use anywhere in the app is `h-8` — 32 CSS px — so 1x is
// 174×32 and 2x is 348×64. They were once 875×161 and 1750×322: a wordmark
// shipped at five and ten times the size it is ever drawn at, for 79kB and
// 287kB, on every page of the app including every storefront. Resizing them
// to the rendered size cost nothing visible and took the pair from 366kB to
// 27kB. If a screen ever needs the lockup LARGER than 32px, re-export both
// files at the new size rather than letting this one grow back.
export default function Wordmark({ className }: { className?: string }) {
  return (
    <img
      src={logo}
      srcSet={`${logo} 1x, ${logo2x} 2x`}
      // Intrinsic size keeps the row from reflowing before the PNG decodes;
      // the height class below overrides it, w-auto keeps the 174:32 ratio.
      width={174}
      height={32}
      alt="TinyOrder"
      draggable={false}
      className={cn('block w-auto select-none', className)}
    />
  )
}
