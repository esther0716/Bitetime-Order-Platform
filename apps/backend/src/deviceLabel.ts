// The one line a merchant reads for each of their signed-in devices: "Chrome on macOS".
//
// A user-agent string is a claim the browser makes about itself, not a fact. It is good enough to
// help a merchant recognise their own phone in a list of two, and it is used for nothing else —
// no rule reads it, and no security decision rests on it.
//
// This deliberately does NOT return a best guess. "Unknown device" is honest and a wrong device
// name is not: the merchant is about to decide which session to sign out.

// Order matters twice over. Edge and Opera both carry the full Chrome agent, and Chrome carries
// "Safari", so the more specific name has to be tested first or every browser reads as Chrome.
const BROWSERS: [RegExp, string][] = [
  [/\bEdg[A-Z]?\//, 'Edge'],
  [/\bOPR\/|\bOpera\//, 'Opera'],
  [/\bFirefox\/|\bFxiOS\//, 'Firefox'],
  [/\bChrome\/|\bCriOS\//, 'Chrome'],
  [/\bSafari\//, 'Safari'],
]

// iPhone and iPad are tested before Macintosh: an iPad's agent says "like Mac OS X".
const PLATFORMS: [RegExp, string][] = [
  [/\biPhone\b/, 'iPhone'],
  [/\biPad\b/, 'iPad'],
  [/\bAndroid\b/, 'Android'],
  [/\bWindows\b/, 'Windows'],
  [/\bMacintosh\b|\bMac OS X\b/, 'macOS'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bLinux\b/, 'Linux'],
]

function firstMatch(table: [RegExp, string][], ua: string): string | null {
  for (const [pattern, name] of table) if (pattern.test(ua)) return name
  return null
}

/** A short human name for a user-agent string, or 'Unknown device' when it cannot be read. */
export function deviceLabel(userAgent: string | null): string {
  const ua = userAgent ?? ''
  const browser = firstMatch(BROWSERS, ua)
  const platform = firstMatch(PLATFORMS, ua)
  if (browser && platform) return `${browser} on ${platform}`
  return browser ?? platform ?? 'Unknown device'
}
