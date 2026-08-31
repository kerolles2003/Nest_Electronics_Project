/**
 * A minimal single-value TTL cache.
 *
 * Authority: docs/architecture/SEARCH-MODEL.md §11 — the category tree and the
 * brand list are cached in-process for 15 minutes. Legacy queried the tree on
 * EVERY page render because the root layout rendered an async navbar, producing
 * 1,664 sequential scans.
 *
 * In-process is sufficient for a single instance. Multi-instance deployment is
 * a Redis trigger (REDIS-DECISION.md), not something to pre-build here.
 */
export class TtlCache<T> {
  private value: T | undefined;
  private expiresAt = 0;

  constructor(private readonly ttlMs: number) {}

  async get(load: () => Promise<T>): Promise<T> {
    const now = Date.now();

    if (this.value !== undefined && now < this.expiresAt) {
      return this.value;
    }

    const loaded = await load();
    this.value = loaded;
    this.expiresAt = now + this.ttlMs;

    return loaded;
  }

  /** Called by catalogue writes once they exist. */
  invalidate(): void {
    this.value = undefined;
    this.expiresAt = 0;
  }
}

export const CATALOG_CACHE_TTL_MS = 15 * 60 * 1000;
