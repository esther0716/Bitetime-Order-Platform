/**
 * Section anchors that something OUTSIDE the legal documents links to.
 *
 * Its own module so the marketing landing page can link the refund policy without importing
 * `documents.ts` — that would pull the full text of both documents into the landing chunk, which
 * is the one chunk a first-time visitor always downloads.
 */

/** The refund and cancellation section of the Terms. Linked from the marketing footer, because
 *  a refund policy has to be findable without reading the whole document. */
export const REFUNDS_ANCHOR = 'refunds'
