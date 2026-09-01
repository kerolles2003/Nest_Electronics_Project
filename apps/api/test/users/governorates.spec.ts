import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from '@jest/globals';
import { EGYPTIAN_GOVERNORATES } from '../../src/common/constants/governorates';

/**
 * The two governorate lists must never diverge.
 *
 * `apps/api` holds its own copy of the list because it has **zero
 * workspace-package dependencies** and that property is worth more than
 * deduplicating a string array. Duplication is only acceptable when drift is
 * impossible, so this suite reads the other copy — `packages/config`, which the
 * storefront uses to build its dropdown — and fails if they differ.
 *
 * ## Why it reads the file as TEXT
 *
 * Importing `@nest/config` would give `apps/api` its first workspace
 * dependency, which is the very thing the copy exists to avoid; doing it in a
 * test would be the same coupling with a thinner disguise. Reading and parsing
 * the source keeps the boundary intact while still making drift a red test.
 *
 * ## Why it matters more than tidiness
 *
 * The storefront offers the client list; the API enforces its own. If the
 * storefront gains a governorate the API does not know, a customer picks it
 * from a dropdown and is rejected at the address form. If the API gains one the
 * storefront lacks, nobody can select it. Either way it surfaces as a customer
 * failure, not as a lint error.
 */

const PACKAGES_CONFIG = resolve(
  __dirname,
  '../../../../packages/config/src/constants.ts',
);

/** Extracts the string literals from the `EGYPTIAN_GOVERNORATES` array. */
function governoratesFromPackagesConfig(): string[] {
  const source = readFileSync(PACKAGES_CONFIG, 'utf8');

  const start = source.indexOf('EGYPTIAN_GOVERNORATES');
  expect(start).toBeGreaterThan(-1);

  const open = source.indexOf('[', start);
  const close = source.indexOf(']', open);
  expect(open).toBeGreaterThan(-1);
  expect(close).toBeGreaterThan(open);

  return [...source.slice(open + 1, close).matchAll(/'([^']+)'/g)].map((m) => m[1] as string);
}

describe('the governorate list', () => {
  it('is exactly 27 entries, with no duplicates and nothing blank', () => {
    expect(EGYPTIAN_GOVERNORATES).toHaveLength(27);
    expect(new Set(EGYPTIAN_GOVERNORATES).size).toBe(27);

    for (const name of EGYPTIAN_GOVERNORATES) {
      expect(name.trim()).toBe(name);
      expect(name.length).toBeGreaterThan(1);
    }
  });

  it('contains the two governorates D-8 prices differently', () => {
    // 50 EGP for Cairo and Giza, 100 EGP elsewhere. If either name changed
    // spelling, the Phase 5 seed would silently price them as "elsewhere".
    expect(EGYPTIAN_GOVERNORATES).toContain('Cairo');
    expect(EGYPTIAN_GOVERNORATES).toContain('Giza');
  });

  it('matches packages/config exactly, in content and order', () => {
    const fromPackages = governoratesFromPackagesConfig();

    // Sanity check on the parser itself: if it silently matched nothing, the
    // comparison below would pass for the wrong reason on an empty list.
    expect(fromPackages).toHaveLength(27);
    expect(fromPackages).toEqual([...EGYPTIAN_GOVERNORATES]);
  });
});
