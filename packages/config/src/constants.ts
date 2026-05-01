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
} as const;
