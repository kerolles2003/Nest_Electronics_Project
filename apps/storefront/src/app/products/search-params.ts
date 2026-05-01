import { createSearchParamsCache, parseAsInteger, parseAsString, parseAsBoolean } from 'nuqs/server';

export const productsSearchParamsSchema = {
  page: parseAsInteger.withDefault(1),
  q: parseAsString.withDefault(''),
  category: parseAsString,
  brand: parseAsString,
  min_price: parseAsInteger,
  max_price: parseAsInteger,
  in_stock: parseAsBoolean.withDefault(false),
  sort: parseAsString.withDefault('newest'),
};

export const searchParamsCache = createSearchParamsCache(productsSearchParamsSchema);
