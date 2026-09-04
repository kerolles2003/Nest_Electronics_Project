export const SITE_NAME = 'Nest Electronics';
export const SITE_DESCRIPTION = 'Egypt\'s premier electronics & embedded systems store for engineers, students, and makers.';
export const SITE_URL = process.env['NEXT_PUBLIC_SITE_URL'] ?? 'https://nest-electronics.com';
export const CURRENCY = 'EGP';
export const CURRENCY_SYMBOL = 'EGP';
export const DEFAULT_PAGE_SIZE = 24;
export const MAX_PAGE_SIZE = 100;
export const CART_RESERVATION_TIMEOUT_MINUTES = 30;
export const LOW_STOCK_THRESHOLD = 5;
export const MAX_REVIEW_IMAGES = 5;
export const MAX_CART_ITEM_QUANTITY = 99;

export const EGYPTIAN_GOVERNORATES = [
  'Cairo', 'Giza', 'Alexandria', 'Dakahlia', 'Red Sea', 'Beheira',
  'Fayoum', 'Gharbia', 'Ismailia', 'Menofia', 'Minya', 'Qaliubiya',
  'New Valley', 'Suez', 'Aswan', 'Assiut', 'Beni Suef', 'Port Said',
  'Damietta', 'Sharkia', 'South Sinai', 'Kafr El Sheikh', 'Matrouh',
  'Luxor', 'Qena', 'North Sinai', 'Sohag',
] as const;
export type EgyptianGovernorate = typeof EGYPTIAN_GOVERNORATES[number];

export const ROUTES = {
  home: '/',
  products: '/products',
  product: (slug: string) => `/products/${slug}`,
  category: (slug: string) => `/categories/${slug}`,
  brand: (slug: string) => `/brands/${slug}`,
  search: '/search',
  cart: '/cart',
  checkout: '/checkout',
  wishlist: '/wishlist',
  compare: '/compare',
  blog: '/blog',
  blogPost: (slug: string) => `/blog/${slug}`,
  login: '/login',
  register: '/register',
  forgotPassword: '/forgot-password',
  account: {
    profile: '/account/profile',
    orders: '/account/orders',
    order: (id: string) => `/account/orders/${id}`,
    addresses: '/account/addresses',
    notifications: '/account/notifications',
  },
  contact: '/contact',
  about: '/about',
  faq: '/faq',
} as const;

/*
 * "Track Order" is deliberately absent.
 *
 * Guest order tracking was dropped with guest checkout: every order now belongs
 * to an account, so the destination for "where is my order?" is
 * `/account/orders`, which the account menu already reaches. PLAN.md 9 records
 * the condition under which the public page comes back.
 */
/*
 * Only routes that exist.
 *
 * `/about` and `/faq` were here, and `/vendors` was in the main navigation.
 * None of the three has ever been a route, so they were a 404 in the chrome of
 * EVERY page on the site — a crawl of fifteen customer-facing pages found six
 * such links, each present on all fifteen.
 *
 * They are removed rather than pointed somewhere plausible: a link that lands
 * on the wrong page is a worse answer than no link. Restoring "About" and
 * "FAQs" is a content decision — the QA report recommends it, and the entry
 * goes back here the day the page does. `/vendors` describes a marketplace this
 * shop is not.
 */
export const TOP_NAV_LINKS = [
  { label: 'Contact', href: '/contact' },
] as const;

export const MAIN_NAV_LINKS = [
  { label: 'Home', href: ROUTES.home },
  { label: 'Shop', href: ROUTES.products },
  { label: 'Blog', href: ROUTES.blog },
  { label: 'Contact', href: '/contact' },
] as const;

