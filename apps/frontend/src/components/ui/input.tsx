import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

/**
 * Input — brand-themed to `.field input`.
 *
 * Props:
 *   variant="compact"  →  matches `.product-row input` / `.admin-field input`
 *                         (px-2.5 py-[7px] text-[13px] bg-background)
 *   (default)          →  `.field input` (px-[13px] py-2.5 text-[14px] bg-card)
 */
function Input({
  className,
  type,
  variant,
  onWheel,
  ...props
}: React.ComponentProps<"input"> & { variant?: "default" | "compact" }) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      data-variant={variant}
      // number inputs: scroll-to-change is a mouse-wheel trap on desktop — blur
      // before the wheel event reaches the input so it scrolls the page instead.
      onWheel={type === "number" ? (e => { e.currentTarget.blur(); onWheel?.(e) }) : onWheel}
      className={cn(
        // .field input — full-width, 13px H-pad, raised bg, clay border, md radius
        "w-full min-w-0 rounded-md border border-border bg-card px-[13px] py-2.5 text-[16px] text-foreground transition-colors outline-none",
        // A PLACEHOLDER MUST NOT READ AS A VALUE. On `--color-text-muted` (--ink-600) it is the
        // same grey as secondary copy, so a short hint — "e.g. Beverage" — looks like a name
        // already typed in, and two empty fields look like two filled ones. --ink-500 is a step
        // lighter and clears AA on white at 4.83:1 (tokens.css says so; tokens.test.ts pins it).
        //
        // NOT for the compact variant, which sits on the CREAM canvas where --ink-500 falls to
        // 4.06:1 — the Subtle-Is-Not-Text Rule, and the reason this is per-variant rather than
        // one class. The default variant's own `bg-card` is what makes the lighter grey legal.
        "placeholder:text-ink-500 data-[variant=compact]:placeholder:text-muted-foreground",
        "focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/10",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
        "file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
        // compact: .product-row input / .admin-field input
        "data-[variant=compact]:px-2.5 data-[variant=compact]:py-[7px] data-[variant=compact]:text-[14px] data-[variant=compact]:bg-background data-[variant=compact]:rounded-sm",
        className
      )}
      {...props}
    />
  )
}

export { Input }
