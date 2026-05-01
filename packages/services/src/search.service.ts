import type { ISearchRepository } from '@nest/repositories';
import type { SearchOptions, SearchResult } from '@nest/types';

export class SearchService {
  constructor(private searchRepo: ISearchRepository) {}

  async searchProducts(query: string, options: SearchOptions): Promise<SearchResult> {
    return this.searchRepo.search(query, options);
  }

  async getSearchSuggestions(query: string, limit = 5): Promise<string[]> {
    if (!query.trim()) return [];
    return this.searchRepo.suggest(query, limit);
  }
}
