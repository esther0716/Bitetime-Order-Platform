import { AuthClient } from '@supabase/auth-js'
import { StorageClient } from '@supabase/storage-js'

// Hand-wired instead of @supabase/supabase-js's createClient(), which always instantiates
// postgrest-js, realtime-js and functions-js too. The frontend never calls .from()/.channel()/
// .functions (see CLAUDE.md "Two ways to reach Postgres" — browser data reads/writes go through
// the backend API in api.ts/store.ts); those three subclients rode along in every page's bundle
// anyway, including the prerendered marketing page, which authenticates no one.
//
// This mirrors createClient()'s own internals (SupabaseClient.ts in the pinned
// @supabase/supabase-js@2.108.2 source) closely enough to be a behavioural drop-in:
// - same storageKey, so an already-signed-in visitor's persisted session is still found under it
// - same auth headers
// - a fetch wrapper on the Storage client that attaches the CURRENT session's access token (not
//   just the anon key) to every request, because product-images/payment-qr bucket policies gate
//   writes on current_merchant_id(), which resolves from the caller's JWT — the anon key alone
//   authenticates as nobody's merchant and every upload would be rejected by RLS.

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? 'https://wthglouiidzyljzcprku.supabase.co'
const supabaseKey = import.meta.env.VITE_SUPABASE_KEY ?? 'sb_publishable_NyCkzEy6HO_H67Gk_xE6jg_Oe6VP1Xt'

const baseUrl = new URL(supabaseUrl)
const authUrl = new URL('auth/v1', baseUrl).href
const storageUrl = new URL('storage/v1', baseUrl).href

// Matches createClient()'s default: namespaces the persisted session under the project ref (the
// URL's first hostname label), so this change does not sign anyone out.
const storageKey = `sb-${baseUrl.hostname.split('.')[0]}-auth-token`

export const auth = new AuthClient({
  url: authUrl,
  headers: { Authorization: `Bearer ${supabaseKey}`, apikey: supabaseKey },
  storageKey,
  autoRefreshToken: true,
  persistSession: true,
  detectSessionInUrl: true,
  flowType: 'implicit',
})

async function currentAccessToken(): Promise<string> {
  const { data } = await auth.getSession()
  return data.session?.access_token ?? supabaseKey
}

const authedFetch: typeof fetch = async (input, init) => {
  const headers = new Headers(init?.headers)
  if (!headers.has('apikey')) headers.set('apikey', supabaseKey)
  if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${await currentAccessToken()}`)
  return fetch(input, { ...init, headers })
}

export const storage = new StorageClient(storageUrl, {}, authedFetch)
