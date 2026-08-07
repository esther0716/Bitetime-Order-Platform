import * as React from "react"

import { cn } from "@/lib/utils"

// Themed to `.field input` — same raised bg, clay border, md radius, 14px text.
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-md border border-border bg-card px-[13px] py-2.5 text-[16px] text-foreground transition-colors outline-none",
        // A step lighter than muted copy so the hint does not read as a value — see the note in
        // input.tsx. Unconditional here: this has no compact variant, so it is always on
        // `bg-card` (white), where --ink-500 clears AA at 4.83:1.
        "placeholder:text-ink-500",
        "focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/10",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
