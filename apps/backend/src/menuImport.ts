// Reads a photograph of a shop's menu and returns DRAFT products for the merchant to correct.
// See tasks/prd-ai-menu-import.md.
//
// Pure adapter, shaped like releases.ts and github.ts next door: the API key is a PARAMETER,
// never read from env.ts, and this file imports nothing from supabase.ts / db.ts. That is what
// lets a unit test drive it with zero env vars and no Supabase stack.
//
// Best-effort in the same way releases.ts is: it swallows its own errors and returns null rather
// than throwing. It differs in what a null MEANS. A release without a summary is cosmetic, so
// that caller stores the error and moves on; here the caller must REFUSE, because the failure
// mode this whole module is built against is a menu that silently comes back empty or wrong.
//
// Nothing in here writes anything. The return value is a proposal; `products` rows are created by
// the merchant pressing save in the normal editor, through the normal path, under the normal
// rules.
import Anthropic from '@anthropic-ai/sdk'

/** One item read off the menu, before the merchant has seen it. */
export interface MenuDraftItem {
  name: string
  name_zh?: string
  /**
   * Maps to the `descr` column. There is deliberately NO Chinese twin: `descr_zh` exists in the
   * table but is excluded from the product write allowlist (writes.ts), and the product form has
   * no field for it either. Reading one off the menu would produce a value the merchant can
   * neither see nor correct nor save — worse than not reading it. `name_zh` has none of these
   * problems and is read.
   */
  description?: string
  /** Exactly as printed on the menu. Kept even when it parses, so the merchant can check it. */
  price_text: string
  /** `price_text` as a number, or null when it could not be read. NEVER defaulted to 0. */
  price: number | null
  unit?: string
  unit_quantity?: number
  /**
   * The menu's own section heading, as words. Deliberately NOT a `category_id`: category ids are
   * per-shop entries in `merchants.product_categories` with no foreign key behind them (ADR 0013),
   * so an id this reader invented and `null` are one state — uncategorized — and the merchant
   * would never be told. A label can be matched against what the shop actually holds, or refused.
   */
  category_label?: string
}

export interface MenuDraft {
  items: MenuDraftItem[]
}

/**
 * The units the product form offers, duplicated from `UNITS` in ProductsManager.tsx.
 *
 * A deliberate twin rather than a move into @bitetime/shared, and the same trade notify.ts makes
 * with its currency copy: only ONE side is authoritative here. The form's `Select` decides what a
 * unit may be; this list exists so the reader emits values that survive it. A free-text unit —
 * "bowl", "portion" — is not a smaller version of that, it is a draft whose unit silently
 * vanishes when the merchant opens the row.
 *
 * Drift costs one unit falling back to the form's default. Add a unit to the form, add it here.
 */
const UNITS = ['pcs', 'box', 'set', 'pack', 'dozen', 'bottle', 'jar', 'tray', 'slice', 'kg', 'g'] as const

export type MenuMediaType = 'image/jpeg' | 'image/png'

/**
 * The largest menu photograph the import accepts, before base64 encoding.
 *
 * 5 MB is roughly a modern phone's own full-quality JPEG, so a merchant photographing a menu
 * board is under it without being told to do anything. It lives here beside the reader rather
 * than at the route because it is a fact about what this module can be asked to read.
 */
export const MAX_MENU_IMAGE_BYTES = 5 * 1024 * 1024

export interface MenuImportInput {
  imageBase64: string
  mediaType: MenuMediaType
  /** The shop's own currency (`merchants.currency`), so a bare "12.50" is read as its own money. */
  currency: string
}

export type ExtractMenu = (apiKey: string, input: MenuImportInput) => Promise<MenuDraft | null>

/**
 * Turns a printed price into a number, or refuses.
 *
 * Refusing is the point. A menu says "Market price", or prints two prices for two sizes, and a
 * reader that guesses produces a product priced 0 or priced wrong — and the merchant scrolling a
 * long import will not catch it. A null here becomes an empty REQUIRED field on the review
 * screen, which they cannot save past.
 *
 * Thousands separators are stripped as commas, which is right for the "1,250.00" this platform's
 * shops print and wrong for the European "12,50". No shop on the platform writes the latter; if
 * one ever does, this is the line that has to know about it.
 */
export function parsePrice(text: string): number | null {
  const cleaned = text.replace(/,(?=\d{3}\b)/g, '')
  const numbers = cleaned.match(/\d+(?:\.\d+)?/g)
  // No number, or more than one: either way this is not a single unambiguous price.
  if (!numbers || numbers.length !== 1) return null
  // A leading minus survives the digit match above, so check the source text for it.
  if (/-\s*\d/.test(cleaned)) return null
  const value = Number(numbers[0])
  if (!Number.isFinite(value) || value < 0) return null
  return value
}

function buildPrompt(currency: string): string {
  return `This photograph shows the menu of a small food business. Read every item you can see and return it as data.

The shop prices in ${currency}. A bare number such as "12.50" is an amount in ${currency}.

For each item on the menu:
- "name": the item name in English, as printed. Required.
- "name_zh": the item name in Chinese. Give this ONLY if the menu prints a Chinese name. Do not translate the English name yourself.
- "description": the item's description, as printed. Omit it if the menu prints none.
- "price_text": the price exactly as printed, including any currency symbol — "RM 12.50", "12.50", "Market price". Copy it; do not convert, round or reformat it. Required.
- "unit": what one order of this item is, chosen from this exact list: pcs, box, set, pack, dozen, bottle, jar, tray, slice, kg, g. Pick the closest one — a menu saying "per slice" gives "slice", "box of 6" gives "box". Omit it when nothing in the list fits or the menu does not say.
- "unit_quantity": the number in that unit when the menu states one, so "box of 6" gives 6. Omit it otherwise.
- "category_label": the section heading this item sits under on the menu, as printed — "Cookies", "Hot Drinks". Omit it if the menu has no sections.

Rules:
- Copy what is printed. Do not invent an item, a description, a price or a translation.
- If a price is unreadable or the menu prints words instead of a number, put those words in "price_text" anyway. Never guess a number.
- Skip anything that is not a sellable item: opening hours, addresses, phone numbers, social media handles, slogans.
- If the photograph shows no menu at all, return an empty list.`
}

// Structured outputs reject the constraint keywords (minLength, minimum, and so on), so this is
// types and required-ness only. Every field the merchant must be able to leave blank is optional
// here too — a reader forced to emit a Chinese name will invent one.
const MENU_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          name_zh: { type: 'string' },
          description: { type: 'string' },
          price_text: { type: 'string' },
          unit: { type: 'string', enum: UNITS },
          unit_quantity: { type: 'integer' },
          category_label: { type: 'string' },
        },
        required: ['name', 'price_text'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
} as const

/** The reader's own output, before this module has cleaned it. */
interface RawItem {
  name?: unknown
  name_zh?: unknown
  description?: unknown
  price_text?: unknown
  unit?: unknown
  unit_quantity?: unknown
  category_label?: unknown
}

const str = (v: unknown): string | undefined => {
  if (typeof v !== 'string') return undefined
  const trimmed = v.trim()
  return trimmed === '' ? undefined : trimmed
}

function toDraftItem(raw: RawItem): MenuDraftItem | null {
  const name = str(raw.name)
  // No name, no product. The review screen has nothing to show for a row like this, and a blank
  // row among forty is exactly the one a merchant saves without noticing.
  if (!name) return null

  const priceText = str(raw.price_text) ?? ''
  const quantity = typeof raw.unit_quantity === 'number' && Number.isInteger(raw.unit_quantity) && raw.unit_quantity > 0
    ? raw.unit_quantity
    : undefined

  const unit = str(raw.unit)

  return {
    name,
    name_zh: str(raw.name_zh),
    description: str(raw.description),
    price_text: priceText,
    price: parsePrice(priceText),
    // Belt to the schema's enum: a unit outside the form's list would vanish from the Select
    // without saying so, which is exactly the silent loss this module is built to avoid.
    unit: unit && (UNITS as readonly string[]).includes(unit) ? unit : undefined,
    unit_quantity: quantity,
    category_label: str(raw.category_label),
  }
}

export const extractMenu: ExtractMenu = async (apiKey, input) => {
  if (!apiKey) {
    console.error('Menu import skipped: no Anthropic API key configured')
    return null
  }
  try {
    const client = new Anthropic({ apiKey })
    const response = await client.messages.create({
      // Opus, not the Haiku releases.ts uses. That call rewrites text that already exists and a
      // clumsy sentence costs nothing; this one reads PRICES off a photograph, and a misread
      // price is money. Adaptive thinking for the same reason — a crowded menu board is a
      // genuine reading problem, not a transcription.
      model: 'claude-opus-5',
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: {
        format: { type: 'json_schema', schema: MENU_SCHEMA },
      },
      messages: [{
        role: 'user',
        content: [
          // Image first, instruction second: the reader should have the menu in hand before it
          // is told what to do with it.
          {
            type: 'image',
            source: { type: 'base64', media_type: input.mediaType, data: input.imageBase64 },
          },
          { type: 'text', text: buildPrompt(input.currency) },
        ],
      }],
    })

    if (response.stop_reason === 'max_tokens') {
      // A truncated payload is not a short menu, it is half a menu — and the half that is
      // missing has no marker on screen. Refuse the whole import.
      console.error('Menu import ran out of tokens')
      return null
    }

    if (response.stop_reason === 'refusal') {
      console.error('Menu import was refused')
      return null
    }

    const block = response.content.find((b) => b.type === 'text')
    if (!block || block.type !== 'text') {
      console.error('Menu import returned no text content')
      return null
    }

    const parsed = JSON.parse(block.text) as { items?: unknown }
    if (!Array.isArray(parsed.items)) {
      console.error('Menu import returned no item list')
      return null
    }

    const items = parsed.items
      .map((raw) => toDraftItem(raw as RawItem))
      .filter((item): item is MenuDraftItem => item !== null)

    // An empty list is a RESULT, not a failure: it is what an unreadable photo, or a photo of
    // something that is not a menu, correctly produces. The caller tells the merchant that
    // nothing was found, which is true and actionable — unlike a refusal, which reads as a bug.
    return { items }
  } catch (e) {
    console.error('Menu import failed:', e instanceof Error ? e.message : String(e))
    return null
  }
}
