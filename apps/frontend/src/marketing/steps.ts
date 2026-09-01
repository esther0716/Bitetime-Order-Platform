// The three steps. Each is a REAL screen recording of the screen it describes — not a drawing, not
// a stock photograph and not a pan over a still. Each `file` names TWO assets per language, both
// 960x720: `<file>-<lang>.mp4`, the clip, and `<file>-<lang>.webp`, its FIRST FRAME, used as the
// poster. Recorded against a running stack; the language pair is picked at render time, because a
// Chinese reader following three clips of an English dashboard is the same "not built for me"
// signal the rotating hero word exists to remove.
//
// Motion earns its bytes here only because each clip shows something a still cannot: the slug
// writing itself as the shop name is typed, the saved row landing in the table, the quantities
// moving as a customer picks. A clip that only panned over a screenshot would be decoration.
//
// `public/` is copied verbatim by Vite, so these carry NO content hash. `vercel.json` serves
// /images immutable for that reason, which makes the rule the same one the self-hosted fonts
// follow: RE-RECORDING A STEP MEANS GIVING IT A NEW FILE NAME. Re-record under the same name and
// every visitor who has been here keeps the old one.
//
// Sized 960x720 and declared at that size, so the row reserves its box before anything lands.
export const STEPS = [
  {
    n: '01',
    file: 'step-1-create-shop',
    title: { en: 'Create your shop', zh: '创建你的店铺' },
    body: { en: 'Pick a name, describe what you make.', zh: '取个名字，介绍你的产品。' },
    alt: {
      en: 'The TinyOrder signup form, with a shop name typed in and the shop link below it',
      zh: 'TinyOrder 注册表单，已填入店铺名称，下方显示店铺链接',
    },
  },
  {
    n: '02',
    file: 'step-2-add-products',
    title: { en: 'Add your products', zh: '添加产品' },
    body: { en: 'Set names, prices and delivery windows.', zh: '设置名称、价格与交货时间。' },
    alt: {
      en: 'The product list in the TinyOrder dashboard, showing names, categories and prices',
      zh: 'TinyOrder 后台的产品列表，显示名称、分类与价格',
    },
  },
  {
    n: '03',
    file: 'step-3-share-link',
    title: { en: 'Share your link', zh: '分享专属链接' },
    body: {
      en: 'Send /s/yourshop to customers; orders come straight to you.',
      zh: '将 /s/yourshop 发给顾客，订单直达你。',
    },
    alt: {
      en: 'A finished storefront, showing the shop name and its menu with prices',
      zh: '完成的店面，显示店铺名称与带价格的菜单',
    },
  },
]
