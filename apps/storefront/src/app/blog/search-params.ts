import { createSearchParamsCache, parseAsInteger, parseAsString } from 'nuqs/server';

export const blogSearchParamsSchema = {
  page: parseAsInteger.withDefault(1),
  category: parseAsString,
  tag: parseAsString,
  search: parseAsString,
};

export const searchParamsCache = createSearchParamsCache(blogSearchParamsSchema);
