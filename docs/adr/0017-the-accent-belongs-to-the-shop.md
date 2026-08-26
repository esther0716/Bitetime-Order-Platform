# The accent belongs to the shop, not to the platform

`tokens.css` said `--brand-500: #7A1028; /* the accent. Does not change. */`, and `DESIGN.md` §5
states The One Voice Rule: oxblood is the only brand accent, and a screen with two accents fighting
has one of them wrong. Both are now qualified. A merchant picks their own colour
(`merchants.brand_color`), and their storefront and their dashboard wear it. Those statements were a
real position, taken deliberately, and this ADR exists so nobody later reads the reversal as drift —
the same job ADR 0012 does for the warm identity.

What is reversed is narrower than it looks. **The One Voice Rule survives inside every page**: there
is still exactly one accent on any screen, still no second saturated colour competing with it, and
the status set is still reserved for status. What changed is that the one voice is now the SHOP's on
a shop's pages and the PLATFORM's everywhere else. TinyOrder keeps oxblood on the marketing site,
`/admin` and the auth screens, because no `BrandTheme` wrapper is above them.

Three consequences worth stating plainly.

**(1) A derived palette cannot be gated by `tokens.test.ts`.** That suite asserts contrast over the
literal hexes in `tokens.css`, and a shop's ramp does not exist until a merchant types one. The
guarantee moves rather than disappearing: `brandTheme.test.ts` sweeps ~8,900 colours — every 15° of
hue by every 10% of saturation by every 3% of lightness — and asserts the same AA floor on the four
pairs the derivation produces, plus that the ramp stays monotonic. A colour a merchant can pick and
a colour we shipped are now checked by two different suites, to the same standard.

**(2) The primitives are now written by product code, once.** `tokens.css` says colour primitives
are never referenced by product code, and `components/BrandTheme.tsx` restates `--brand-50…700` on a
wrapper element. The rule is about *consumption* — product code must reach for a semantic token, and
still must. This is the theming layer supplying the primitives, which is the one place they may be
written. It sets the primitives rather than the `--color-brand-*` bridge because both `@theme`
blocks are `@theme inline`: Tailwind substitutes at build time, so `bg-brand-100` compiles to
`var(--brand-100)` and the bridge is never read at runtime.

**(3) `--primary-foreground` became real.** Ten elements filled with the accent labelled themselves
`text-background` — the cream page colour — while the token that names the on-fill colour sat unread
at white. Cream on oxblood reads; cream on a pale yellow does not. They now use
`text-primary-foreground`, which is what lets a computed on-fill colour reach them, and which makes
`DESIGN.md` §5's "primary buttons carry white text" true for the first time. The visible cost is
that those labels went from cream to white on every screen, the marketing pages included.

The alternative considered and rejected was a fixed set of pre-verified themes. It removes the
contrast question entirely and cannot match a shop whose logo is a specific teal — which is the
whole of what a merchant means by "my colours". Deriving the palette and proving the derivation
safe is more work than shipping six palettes, and it is the version that answers the request.
