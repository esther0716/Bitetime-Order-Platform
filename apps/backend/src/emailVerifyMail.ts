// Pure email builder for the merchant address check. Same shape and the same reason as
// buildTrialFeedbackEmail: text-only transactional mail, kept away from anything that imports
// env.ts so `pnpm test` can read the copy back without a Supabase stack.
//
// The wording matters more than it looks. This mail arrives AFTER the merchant is already
// inside their dashboard, so it must not read as a gate — a merchant who thinks their shop is
// waiting on this will sit and wait for it. It says what it is: a check that we can reach them.

export interface EmailVerifyMailInput {
  shopName: string
  verifyUrl: string
}

export function buildEmailVerifyMail({ shopName, verifyUrl }: EmailVerifyMailInput) {
  const subject = `Confirm this address for ${shopName}`
  const text = `Hi,

${shopName} is open — nothing is waiting on this email.

We just need to know we can reach you. Receipts, your trial reminder and any password reset go to this address, so please confirm it:

${verifyUrl}

The link works for 7 days. If it expires, ask for a new one from your dashboard.

Didn't sign up? You can ignore this — the address will simply stay unconfirmed.

— TinyOrder`
  return { subject, text }
}
