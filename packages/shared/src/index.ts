// Rules that must hold identically in the frontend and the backend. Source-only: both
// workspaces compile TypeScript themselves (Vite/esbuild/Vitest), so there is no build
// step and no dist — the consumers bundle this source directly.
export { MIN_PASSWORD_LENGTH, isPasswordLongEnough } from './password.js'
export { BUSINESS_NATURES, isBusinessNature } from './businessNature.js'
export type { BusinessNature } from './businessNature.js'
export { CURRENCY_CODES, DEFAULT_CURRENCY, isCurrencyCode } from './currency.js'
export type { CurrencyCode } from './currency.js'
export { MAX_CART_QTY, MAX_CART_LINES, MAX_CART_ENTRIES, isCart } from './cart.js'
export {
  validateFeedback, isFeedbackCategory, isFeedbackStatus,
  validateFeedbackImage, validateFeedbackImages,
  FEEDBACK_CATEGORIES, FEEDBACK_STATUSES, FEEDBACK_MAX_LENGTH,
  FEEDBACK_MAX_IMAGES, MAX_FEEDBACK_IMAGE_BYTES, FEEDBACK_IMAGE_TYPES,
} from './feedback.js'
export type {
  FeedbackCategory, FeedbackStatus, FeedbackDraft, FeedbackValidation,
  FeedbackImageValidation, FeedbackImagesValidation, FeedbackImageError,
} from './feedback.js'
export {
  validateTrialFeedback,
  TRIAL_FEEDBACK_RATING_MIN, TRIAL_FEEDBACK_RATING_MAX, TRIAL_FEEDBACK_COMMENT_MAX_LENGTH,
} from './trialFeedback.js'
export type { TrialFeedbackDraft, TrialFeedbackValidation } from './trialFeedback.js'
export {
  priceOrder, voucherError, shippingFee, voucherFromRow, shopRates, shopTax,
  promoState, promoClaims, productFromRow, optionGroupsFromRow,
  shopDistance, routedKm, distanceFee, exceedsMaxKm,
  shopMethods, offersMethod, firstOfferedMethod, FULFILMENT_METHODS, isDistancePriced,
  EM_STATES, DEFAULT_WM_RATE,
} from './pricing.js'
export type {
  PriceInput, PriceBreakdown, PriceLine,
  VoucherCtx, VoucherErrorCode,
  PricedProduct, PricedVoucher, PromoState, ShopTax, ShopDistance,
  ShopMethods, FulfilmentMethod,
} from './pricing.js'
export {
  fulfilmentConfig, isTimezone, todayInZone,
  isDateSelectable, selectableDates,
  DEFAULT_FULFILMENT, DEFAULT_TIMEZONE,
} from './fulfilment.js'
export type { FulfilmentConfig } from './fulfilment.js'
export { REFUSAL_STATUS, ORDER_REFUSALS, QUOTE_REFUSAL_STATUS, QUOTE_REFUSALS } from './refusal.js'
export type { OrderRefusal, QuoteRefusal } from './refusal.js'
export {
  computeMerchantStats, granularityFor, ordersInWindow, windowTotals, isBooked,
  REVENUE_RANGES, isRevenueRange,
} from './merchantStats.js'
export type {
  MerchantStats, SeriesPoint, SeriesWindow, Slice, StatusSlice, Delta, Granularity,
  StatsOrder, StatsOrderItem, StatsVoucher, WindowTotals, RevenueRange,
} from './merchantStats.js'
export {
  canonicalJson, cartLineKey, validateSelections, validateOptionGroups,
  snapshotSelections, picksDelta,
  deactivateGroups, hasRequiredGroup, hasActiveGroup, canBeAnswered,
  MAX_PICK_QTY, MAX_GROUPS_PER_PRODUCT, MAX_OPTIONS_PER_GROUP,
} from './options.js'
export type {
  Option, OptionGroup, Selection, CartLine, PickSnapshot,
  SelectionError, GroupConfigError,
} from './options.js'
export {
  validateMenuCategories, menuCategoriesFromRow, deactivateCategories,
  MAX_MENU_CATEGORIES, MENU_CATEGORY_NAME_MAX,
} from './menuCategories.js'
export type { MenuCategory, CategoryConfigError } from './menuCategories.js'
