import { waDisplay, waHref } from '../waNumber'

// A WhatsApp deep link. Shared by the customers table, the customer drawer header, and the
// order detail sheet — so all three now read one number one way.
//
// Both halves come from `waNumber.ts` rather than from the stored string:
//
//   * the LABEL, because the same person's number is stored as `+60 12-345 6789` on one order
//     and `0123456789` on the next, and a column of both is unscannable
//   * the HREF, because stripping non-digits (what this used to do) left `wa.me/0198765432` —
//     a link to nobody, since wa.me needs the international form with no leading zero
//
// `stopClick` stops a click bubbling to a clickable row/card behind it (the customers table row
// opens a drawer on click) — harmless where there's no such parent.
export default function WaLink({ wa, stopClick = false }: { wa: string; stopClick?: boolean }) {
  const href = waHref(wa)
  const label = waDisplay(wa)

  // Nothing dialable in there. Still show what the customer wrote — the merchant may recognise
  // it, and a blank cell would look like missing data rather than an unusable number.
  if (href === null) return <span className="whitespace-nowrap text-text-tertiary">{label}</span>

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={stopClick ? e => e.stopPropagation() : undefined}
      // pixel-match of .mm-order-wa + :hover. `whitespace-nowrap` because the formatted number
      // carries spaces and a narrow column would otherwise break `+60 12-345 6789` across two
      // lines — a phone number split in half is harder to read than the raw digits were.
      className="whitespace-nowrap text-oxblood no-underline font-medium hover:underline"
    >
      {label}
    </a>
  )
}
