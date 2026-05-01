import type { SearchOptions, SearchResult } from '@nest/types';

export interface ISearchRepository {
  search(query: string, options: SearchOptions): Promise<SearchResult>;
  suggest(query: string, limit?: number): Promise<string[]>;
}
