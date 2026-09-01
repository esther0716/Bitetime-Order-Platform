// Shared plumbing for the two storefront edge functions (#253). Kept under src/seo so a file in
// api/ never imports another api/ file (Vercel deploys every non-underscore file there as a
// function of its own).

/** The public origin the request arrived on — Vercel fronts the function, so the forwarded
 *  headers name the real host, not the function's internal URL. */
export function requestOrigin(request: Request): string {
  const url = new URL(request.url)
  const host = request.headers.get('x-forwarded-host') ?? url.host
  const proto = request.headers.get('x-forwarded-proto') ?? 'https'
  return `${proto}://${host}`
}

/** The billing backend's URL. `VITE_` marks it as the SPA's build-time var, and that is exactly
 *  why it is reused here: the functions must talk to the same backend the app was built
 *  against, and one env var cannot drift from itself. */
export function backendUrl(): string | undefined {
  return process.env.VITE_API_URL
}
