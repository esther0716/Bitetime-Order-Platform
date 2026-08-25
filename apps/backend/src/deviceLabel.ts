// What a merchant reads for each of their signed-in devices, as PARTS: "Chrome" and "macOS".
//
// It returns the two names and never the sentence joining them. The join is prose — " on ", and
// the "unknown device" fallback — and prose is `t(en, zh)`'s job in the browser (CLAUDE.md →
// Localisation). Returning a finished English string here would hand a Chinese merchant
// "Chrome on macOS" with no way to translate it. The names themselves are proper nouns and are
// the same in both languages.
//
// A user-agent string is a claim the browser makes about itself, not a fact. It is good enough to
// help a merchant recognise their own phone in a list of two, and it is used for nothing else —
// no rule reads it, and no security decision rests on it.
//
// Both fields are null when the string cannot be read. That is deliberate: the caller says
// "unknown device" in the reader's own language rather than being handed a guess, and the
// merchant is about to decide which session to sign out.

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

/** The browser and platform names read out of a user-agent string. Either may be null. */
export interface DeviceIdentity {
  browser: string | null
  platform: string | null
}

/** Read a user-agent string into its browser and platform names, without guessing at either. */
export function deviceIdentity(userAgent: string | null): DeviceIdentity {
  const ua = userAgent ?? ''
  return { browser: firstMatch(BROWSERS, ua), platform: firstMatch(PLATFORMS, ua) }
}
