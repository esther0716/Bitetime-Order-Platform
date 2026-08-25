# The washes are warmed toward the page

`brandTheme.ts` derives a shop's `--brand-*` ramp from one hex. The three pale steps
(`--brand-50/100/200`) measured a fraction of the distance toward **white**. The page is **cream**
(`--cream: #F2EAE0`). The platform accent is oxblood, which is warm, so the two agreed by luck and
the mismatch stayed hidden.

A cool pick shows the mismatch. A blue wash bled to white sits on a warm page as a second, colder
ground. The measurement, in OKLab units from the tint to the canvas: oxblood 1.9, blue 3.1, teal
3.3. `bg-brand-100` has 60 call sites, and the largest are flat areas — the footer band, the
alternating table rows, the active nav item. A merchant who picks blue sees this, and reads it as a
half-finished theme.

## Decision

Each of the three washes is warmed toward the canvas after its lightness walk. The step is a pull
in OKLab toward the canvas chroma, at 35 percent of the distance. **The pull is capped at half of
the tint's own chroma.** Lightness does not move: the `k` figures are the shape of the ramp, and the
warmth is a hue correction.

`--brand-400` is not warmed. It is the dark-theme accent, not a wash on a cream page, so it does not
have the problem. The pull also moved it a visible step off the shipped oxblood ramp for no gain.

## Two simpler rules that fail

**Mix the tint toward the canvas instead of toward white.** This bleaches the wash. At `k = 0.9054`
the destination is nearly neutral, so a 90 percent mix arrives nearly neutral. Blue fell from 44
percent saturation to 6, and it landed **further** from the cream (5.0), because the mix darkens as
it desaturates.

**Pull the finished tint toward the canvas by a fixed fraction.** This destroys the hues the rule
exists for. Cream sits at the warm end of the a/b plane, so blue is the hue furthest from the
destination and the pull is longer than the chroma it acts on. A fixed pull moves a blue tint
straight **through** neutral: blue fell to 3 percent saturation. A shop that picks grey also gained
beige washes it never asked for, because the same pull adds warmth to a neutral tint.

The cap fixes both. It bounds how much of the brand any pick can lose, on either side of neutral. A
cool pick warms and stays cool-hued (blue 3.1 → 2.6 from the canvas, still 19 percent saturated). A
grey pick stays grey, because half of nearly zero is nearly zero. A warm pick is almost unchanged,
because the pull is short to begin with.

## Consequences

**The platform ramp moved, and `tokens.css` follows the derivation, not the other way round.**
`--brand-50/100/200` are now `#FCF1EF`, `#F4E7E6` and `#E6D0D1`, from `#FDF0F2`, `#F5E6E8` and
`#EBCDD3`. The rule that `brandTheme('#7A1028')` reproduces the shipped ramp is what holds this
file together, so the literals had to move with it. `DESIGN.md` carries the same three values.
`--brand-200` moved the most, by about one just-noticeable difference; the other two are inside the
3/255 tolerance the pin test already allowed. `tokens.test.ts` still passes, so every contrast pair
on the new values clears AA.

**HSL is no longer the only colour space here.** `src/oklab.ts` is new. HSL holds a hue while
lightness walks, which is what the rest of the derivation does, and it is a poor space to mix in: a
channel mix between a saturated colour and a near-neutral one dips through a muddy middle. The
warming is the one mix in the ramp, and it needs a perceptual space. The module is Ottosson's
matrices, about 20 lines, and it adds no dependency.

**The cap is a tested property, not a constant nobody checks.** `brandTheme.test.ts` sweeps every 5
degrees of hue and asserts that no wash moves further than the cap allows. It also pins the two
outcomes the cap exists for: a cool pick keeps a visible hue, and a neutral pick gets no beige. The
sweep measures in OKLab. HSL saturation is the wrong instrument for a pale wash — the wash sits
within a few 1/255 steps of white, where HSL saturation swings on a rounding difference and reports
a bleaching that is not there.

**The gain is real and it is small.** 3.1 → 2.6 is a measured improvement, and on screen it is
quiet, because a wash at `k = 0.90` is nearly white either way. It shows most on the large flat
areas. This was accepted with that trade understood.
