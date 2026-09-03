// Builds the merchant signup URL carrying a referral code. Pure + DOM-free so it
// is unit-testable; callers pass window.location.origin at the call site.
// Signup reads the `ref` param and prefills its referral-code field with it (#265); the
// field also accepts this whole URL pasted in, which is what a referrer shares in a chat.
export function referralSignupUrl(code: string, origin: string): string {
  const base = origin.replace(/\/$/, '')
  return `${base}/merchant/signup?ref=${encodeURIComponent(code)}`
}
