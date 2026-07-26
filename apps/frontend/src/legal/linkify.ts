// Turning the contact address in a legal paragraph into something you can actually click.
//
// The documents stay PLAIN STRINGS — that is what keeps them readable as prose, diffable as
// wording, and testable without a renderer. So the link is found at render time rather than
// authored into the text: a paragraph is split into runs, and the shell decides how to draw an
// email run. Markup in `documents.ts` would mean a lawyer's wording change had to be made inside
// JSX, which is exactly the coupling that file exists to avoid.

export type TextRun = { type: 'text'; value: string } | { type: 'email'; value: string }

// Deliberately conservative, and matched against prose rather than validating an address: it must
// not swallow the sentence's trailing punctuation. A full stop directly after an address is far
// more common in these documents than one inside it, so the trailing dot is left to the text run
// and `support@tinyorder.shop.` links only the address.
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g

/**
 * Split a paragraph into plain-text and email runs, in order.
 *
 * A paragraph with no address comes back as a single text run, so the caller needs no special
 * case for the common one.
 */
export function splitOnEmails(text: string): TextRun[] {
  const runs: TextRun[] = []
  let last = 0

  for (const match of text.matchAll(EMAIL)) {
    const start = match.index ?? 0
    if (start > last) runs.push({ type: 'text', value: text.slice(last, start) })
    runs.push({ type: 'email', value: match[0] })
    last = start + match[0].length
  }

  if (last < text.length) runs.push({ type: 'text', value: text.slice(last) })
  return runs
}
