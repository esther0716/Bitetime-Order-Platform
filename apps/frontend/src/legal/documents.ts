// The Terms of Service and Privacy Policy, as structured content rather than markup.
//
// A document is a title and an ordered list of sections; a section is a heading, a stable id and
// a list of paragraphs. That shape is what lets a section be linked to (the refund policy has to
// be), what lets a test see the structure, and what keeps a wording change from touching layout.
//
// ENGLISH ONLY, deliberately, while the rest of the product is bilingual. A mistranslated legal
// term is a liability rather than a rough edge, and a second language doubles what a lawyer must
// review. Each document says so in its own text.
//
// ⚠ Drafted from how this product actually works — not by a lawyer. Both documents need review
// by a Malaysian practitioner before they carry weight, particularly the limitation of liability,
// the governing-law section, and whether the seller model below holds under Malaysian
// consumer-protection law.
import { LEGAL_ENTITY, LEGAL_LAST_UPDATED, isRegisteredEntity } from './entity'
import { REFUNDS_ANCHOR } from './anchors'

export { REFUNDS_ANCHOR }

export interface LegalSection {
  /** Stable, URL-safe. Rendered as the heading's anchor. */
  id: string
  heading: string
  body: string[]
}

export interface LegalDocument {
  title: string
  lastUpdated: string
  sections: LegalSection[]
}

const { name, registration, address, email } = LEGAL_ENTITY

// How the operator identifies itself, composed from what is actually known rather than from a
// fixed sentence with holes in it.
//
// An UNREGISTERED trading name is not a legal person and has no registration number, so the
// documents must not call it "a company registered in Malaysia" — that sentence would be false,
// in the one kind of document where a false statement is the whole failure. Until the business is
// registered, the operator is described plainly as the business behind TinyOrder, with no claim
// of corporate status and no invented number. Filling `registration` in switches both documents
// to the company wording with no further edit.
const OPERATOR_DESCRIPTION = isRegisteredEntity(LEGAL_ENTITY)
  ? `${name} (registration number ${registration}), a company registered in Malaysia with its registered address at ${address}`
  : `${name}, the business that operates TinyOrder, at ${address}`

const DATA_USER_DESCRIPTION = isRegisteredEntity(LEGAL_ENTITY)
  ? `${name} (registration number ${registration}), of ${address}`
  : `${name}, the business that operates TinyOrder, at ${address}`

// One sentence, both documents. It has to appear in each of them — a reader of the Privacy
// Policy has not necessarily read the Terms — but it must not be two sentences that can drift.
const AUTHORITATIVE_LANGUAGE =
  'This document is published in English. Where any translation of it exists, the English version is the authoritative one and governs in the event of a conflict.'

export const TERMS: LegalDocument = {
  title: 'Terms of Service',
  lastUpdated: LEGAL_LAST_UPDATED,
  sections: [
    {
      id: 'who-we-are',
      heading: '1. Who we are',
      body: [
        `TinyOrder is operated by ${OPERATOR_DESCRIPTION}. In these terms, "we", "us" and "TinyOrder" mean that operator. You can reach us at ${email}.`,
        AUTHORITATIVE_LANGUAGE,
      ],
    },
    {
      id: 'what-tinyorder-is',
      heading: '2. What TinyOrder is',
      body: [
        'TinyOrder is ordering software for small food businesses. A shop that signs up gets its own storefront page where its customers can browse a menu, choose a fulfilment method and place an order, and a dashboard where the shop manages its menu, its orders and its settings.',
        'We provide the software. We do not cook, prepare, handle, deliver or sell food, and we do not take payment for it.',
      ],
    },
    {
      id: 'the-shop-is-the-seller',
      heading: '3. The shop is the seller',
      body: [
        'When a customer places an order through a storefront on TinyOrder, the contract of sale is between that customer and that shop. The shop is the seller. We are not a party to it.',
        'This is not a matter of wording. Payment for an order is arranged directly between the customer and the shop — by bank transfer or whatever else the shop instructs — and does not pass through TinyOrder at any point. We store the shop\'s payment instructions as text to display to its customers, and nothing more.',
        'It follows that the shop is responsible for its food and everything about it: accuracy of the menu and prices, food safety and hygiene, allergens and ingredients, preparation, fulfilment and delivery, any licences its business requires, and refunds or compensation for an order.',
        'If you are a customer with a problem about an order — it did not arrive, it was wrong, you want your money back — that is a matter between you and the shop, because the shop took your payment and prepared your food. We can help with problems with the software itself.',
      ],
    },
    {
      id: 'merchant-accounts',
      heading: '4. Shop accounts',
      body: [
        'To run a shop you must create an account and give accurate information about your business. You are responsible for what happens under your account and for keeping your password to yourself.',
        'A new shop is reviewed before it goes live. Until it is approved, the shop exists but its storefront does not accept orders. We may decline to approve a shop, and we do not have to give a reason.',
        'One person may run more than one shop, but each shop is a separate account with its own subscription.',
      ],
    },
    {
      id: 'subscription',
      heading: '5. Subscription, trial and billing',
      body: [
        'Running a shop on TinyOrder requires a paid subscription. Prices are shown on our website and are in Malaysian Ringgit. Subscriptions are billed in advance, either monthly or yearly, through our payment processor.',
        'An approved shop begins with a free trial. The trial does not require a payment card. We will remind you before it ends. If the trial ends without a payment method on the account, the subscription is cancelled and the shop stops accepting orders.',
        'We may change our prices. If we do, we will tell you before the change applies to you, and the change takes effect at your next renewal — never in the middle of a period you have already paid for.',
        'If a payment fails we may suspend the shop until it succeeds.',
      ],
    },
    {
      id: REFUNDS_ANCHOR,
      heading: '6. Refunds and cancellation',
      body: [
        'You can cancel your subscription at any time from your dashboard. Cancellation takes effect at the end of the period you have already paid for: your shop keeps working until then, and you are not billed again.',
        'Because access continues to the end of the paid period, we do not prorate or refund part of a period. Cancelling halfway through a month does not produce a half-month refund; it stops the next payment.',
        'The same applies to moving to a cheaper plan. The change takes effect at your next renewal rather than immediately, so nothing is refunded and nothing is charged at the moment you make it.',
        'Moving to a cheaper plan is not simply the reverse of upgrading, and it is worth knowing before you do it: when the change takes effect, the features of the higher plan stop, and anything you created with them stops with them. Your discount vouchers are deactivated and any running promotional prices end. Upgrading again does not bring them back — you would set them up afresh.',
        'We may refund a payment at our discretion where something has gone wrong on our side — for example a shop that was billed while unusable because of a fault in the software.',
        'Refunds for FOOD ORDERS are not ours to give. The shop received that payment directly and decides what to do about it. See section 3.',
      ],
    },
    {
      id: 'acceptable-use',
      heading: '7. Acceptable use',
      body: [
        'You may not use TinyOrder to sell anything you are not lawfully allowed to sell, to mislead your customers about what they are buying or who they are buying it from, to upload content you have no right to use, or to interfere with the service or with other shops on it.',
        'You may not attempt to reach data belonging to another shop or to another shop\'s customers, or to probe, scan or test the security of the service.',
      ],
    },
    {
      id: 'suspension',
      heading: '8. Suspension and termination',
      body: [
        'We may suspend or close a shop that breaches these terms, that we reasonably believe is being used unlawfully or fraudulently, or whose subscription has lapsed.',
        'A suspended shop\'s storefront stops accepting orders. Its data is not deleted immediately — see the Privacy Policy for how long we keep it — and its owner can still sign in to the dashboard.',
        'You can close your shop at any time. Closing it does not entitle you to a refund of the current period, for the reasons in section 6.',
      ],
    },
    {
      id: 'your-data',
      heading: '9. Data',
      body: [
        'Our Privacy Policy explains what personal data we collect, why, who we share it with and how long we keep it. It forms part of these terms.',
        'As a shop, you will receive personal data about your own customers through TinyOrder — their names, contact numbers and delivery addresses. You are responsible for handling that data lawfully, using it only to fulfil the orders it came with, and not passing it on to anyone else without a proper basis.',
      ],
    },
    {
      id: 'availability',
      heading: '10. Availability',
      body: [
        'We work to keep TinyOrder available, but we do not promise it will be uninterrupted or error-free. We may need to take it down for maintenance, and parts of it depend on third-party services that can fail independently of us.',
        'Some features depend on services outside our control — messaging, email delivery and mapping among them. A failure in one of those is not a failure of the whole service.',
      ],
    },
    {
      id: 'liability',
      heading: '11. Limitation of liability',
      body: [
        'Nothing in these terms limits liability that cannot lawfully be limited, including liability for death or personal injury caused by negligence, or for fraud.',
        'Subject to that, we are not liable for lost profits, lost sales, lost data or indirect or consequential loss, and our total liability to you in any twelve-month period is limited to the amount you paid us for the subscription in that period.',
        'We are not liable for anything arising out of the sale of food by a shop to its customer, which is a contract we are not party to. See section 3.',
      ],
    },
    {
      id: 'changes',
      heading: '12. Changes to these terms',
      body: [
        'We may update these terms. The date at the top of this page shows when they last changed. Where a change materially affects you, we will tell you before it takes effect. Continuing to use TinyOrder after that means you accept the updated terms.',
      ],
    },
    {
      id: 'governing-law',
      heading: '13. Governing law',
      body: [
        'These terms are governed by the laws of Malaysia, and the courts of Malaysia have exclusive jurisdiction over any dispute arising from them.',
      ],
    },
    {
      id: 'contact-terms',
      heading: '14. Contact',
      body: [
        `Questions about these terms go to ${email}, or by post to ${name}, ${address}.`,
      ],
    },
  ],
}

export const PRIVACY: LegalDocument = {
  title: 'Privacy Policy',
  lastUpdated: LEGAL_LAST_UPDATED,
  sections: [
    {
      id: 'data-user',
      heading: '1. Who is responsible for your data',
      body: [
        `${DATA_USER_DESCRIPTION}, is the data user responsible for the personal data described in this notice. You can reach us at ${email}.`,
        AUTHORITATIVE_LANGUAGE,
        'A shop that uses TinyOrder is separately responsible for the customer data it receives and uses in running its own business.',
      ],
    },
    {
      id: 'what-we-collect',
      heading: '2. What we collect',
      body: [
        'If you run a shop: your name and email address, your shop\'s name, its storefront address, its settings, the payment instructions you choose to display to your customers, and — where you set one up — the pickup or delivery origin address you configure.',
        'If you order from a shop: the name, contact number and, for a delivery, the delivery address you give at checkout, along with what you ordered, when, and the total. If you create an account, your email address and any delivery details you choose to save for next time. Your password is stored only as a cryptographic hash — we never hold it in a form anyone can read.',
        'From everyone: basic technical data your browser sends, including your IP address, which we use to limit abuse of the parts of the service that cost us money to run.',
        'We do not collect or store payment card numbers. Subscription payments are handled by our payment processor, and payments for food orders never reach us at all.',
      ],
    },
    {
      id: 'why-we-collect',
      heading: '3. Why we use it',
      body: [
        'To operate the service: to show a shop its orders, to let a customer track an order they placed, to work out a delivery fee for an address, and to send order confirmations and alerts.',
        'To bill shops for their subscriptions, and to handle trials, renewals and cancellations.',
        'To keep the service working and safe: to diagnose faults, to prevent abuse, and to enforce our terms.',
        'To contact you about the service where we need to — a trial ending, a failed payment, a material change to these documents.',
        'We do not sell personal data, and we do not use it for advertising.',
      ],
    },
    {
      id: 'disclosure',
      heading: '4. Who we share it with',
      body: [
        'To the shop you ordered from. Placing an order sends the shop your name, contact number, what you ordered and, for a delivery, your address — because they cannot fulfil the order otherwise. Shops on our paid tier may also receive that order through a messaging service, which means those details are delivered into the shop\'s own messaging account.',
        'To the service providers we run on. Each receives only what it needs, and we name them rather than describe them: Supabase hosts our database and handles sign-in, and so stores the data described above; Stripe processes shops\' subscription payments; Resend delivers order confirmations and account email; Google Maps Platform receives a delivery address when a shop prices delivery by distance, and receives what you type when a shop uses address autocomplete; and Telegram delivers order alerts to shops that have enabled them.',
        'Where the law requires it, or to establish, exercise or defend legal claims.',
        'Some of these providers process data outside Malaysia. Where that happens we rely on the provider\'s own contractual protections.',
      ],
    },
    {
      id: 'retention',
      heading: '5. How long we keep it',
      body: [
        'Order records are kept for as long as the shop that received them is on the platform, because the shop needs its own trading history.',
        'Account data is kept while the account exists. If a shop closes, we keep its data for a reasonable period afterwards to settle billing and handle any dispute, and then remove it.',
        'Cached delivery distance lookups expire within thirty days.',
      ],
    },
    {
      id: 'guest-orders',
      heading: '6. Ordering as a guest',
      body: [
        'You can order without creating an account. If you do, the order is recorded against the shop but not against any account — including one you create later. This is permanent and cannot be undone: a guest order can never be attached to an account afterwards.',
        'That means a guest order will not appear in an account\'s order history, and you track it using the order number and the contact number you gave.',
        'It also means a guest order does not receive a confirmation email, because a guest gives no email address.',
      ],
    },
    {
      id: 'email-addresses',
      heading: '7. A note about email addresses',
      body: [
        'We do not verify a customer\'s email address when an account is created. A mistyped address therefore belongs to whoever actually owns it, and order confirmations sent to that account would reach them — including the order\'s name, items, total and delivery address.',
        'We state this plainly because it is a real consequence of not requiring verification. Please check your address when you sign up.',
      ],
    },
    {
      id: 'your-rights',
      heading: '8. Your rights',
      body: [
        'Under Malaysian personal data protection law you may ask for a copy of the personal data we hold about you, ask us to correct it if it is wrong or incomplete, ask us to limit how we process it, and withdraw consent where our use of it rests on consent.',
        `To exercise any of these, write to ${email}. We may need to confirm who you are before we act, so that we do not disclose your data to someone else. We will respond within the period the law allows.`,
        'If your request concerns data held by a shop rather than by us — the details attached to an order you placed with them — we will point you to that shop, which is responsible for it.',
        'Withdrawing consent or asking us to delete data may mean we can no longer provide parts of the service to you.',
      ],
    },
    {
      id: 'security',
      heading: '9. Security',
      body: [
        'Each shop\'s data is separated from every other shop\'s, and a shop can only reach its own orders and customers. Traffic is encrypted in transit, passwords are stored only as cryptographic hashes and never in a readable form, and access to production data is limited to those who need it.',
        'No system is perfectly secure, and we do not claim otherwise.',
      ],
    },
    {
      id: 'changes-privacy',
      heading: '10. Changes to this notice',
      body: [
        'We may update this notice. The date at the top of this page shows when it last changed. Where a change materially affects you, we will tell you.',
      ],
    },
    {
      id: 'contact-privacy',
      heading: '11. Contact',
      body: [
        `Questions, requests or complaints about your personal data go to ${email}, or by post to ${name}, ${address}.`,
      ],
    },
  ],
}
