import { describe, expect, it } from '@jest/globals';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/**
 * No front end may print a raw amount beside a currency symbol it wrote itself.
 *
 * ## The incident, twice
 *
 * `/admin/customers` rendered `` `EGP ${revenue.delivered.amount.toLocaleString()}` ``.
 * `amount` is **minor units** — the integer the API stores and computes with —
 * so the card read **"EGP 5,000" for fifty pounds**. It was found by eye while
 * changing something else.
 *
 * One commit later the identical defect was found on the same screen, in the
 * per-customer rows: `` `EGP {totalSpent.toLocaleString()}` ``, whose own DTO
 * describes it as *"lifetime spend in minor units"*. Two instances, one screen,
 * both invisible to the type checker — `number` is `number` — and both
 * invisible to a build.
 *
 * A defect that recurs in the same file within a day is not an incident. It is
 * a class, and the answer to a class is a mechanism.
 *
 * ## Why `.formatted` exists, and what this enforces
 *
 * `MoneyDto` carries `amount` (the integer), `currency`, and `formatted` — the
 * display string the SERVER produced. `formatted` exists precisely so that no
 * client ever divides by a hundred, picks a separator, or writes a currency
 * symbol next to a number whose unit it inferred. When a console and an invoice
 * disagree about a price, it is because somebody re-derived one of them.
 *
 * So the rule this enforces is narrow and mechanical: **a hand-written currency
 * token on a line that is also rendering a value** is a finding. That shape
 * catches every form the defect has taken — `EGP {x}`, `` `EGP ${x}` ``,
 * `` `${x} EGP` `` — without needing to understand what `x` is, which is the
 * part a checker cannot do.
 *
 * ## Why an allow-list rather than a cleverer pattern
 *
 * Because several hits are legitimate and no regex distinguishes them from the
 * defect: a filter bound the customer typed in pounds, an input's unit
 * adornment, a `Money` object being constructed. Trying to encode that
 * distinction produces a pattern that is both unreadable and, eventually,
 * wrong in the permissive direction.
 *
 * An allow-list makes each one a decision somebody wrote down. It is checked in
 * BOTH directions so it cannot rot:
 *
 *   - every finding must be allowed, or the test fails — the guard;
 *   - every allowance must still match a real line, or the test fails — so a
 *     line that is deleted or reworded takes its exemption with it instead of
 *     leaving a hole for the next defect to land in.
 *
 * ## Why this lives in the API's test suite
 *
 * It scans `apps/admin` and `apps/storefront`, neither of which has a unit-test
 * runner wired into `turbo test`. `secret-hygiene.spec.ts` sets the precedent:
 * repository-wide guards live here because this is the suite that always runs.
 */

const REPO_ROOT = resolve(__dirname, '../../../..');

/** The front ends. The API never renders money; it produces `formatted`. */
const ROOTS = ['apps/admin/src', 'apps/storefront/src'] as const;

const EXTENSIONS = ['.ts', '.tsx'] as const;

/**
 * A currency token written by hand.
 *
 * `EGP` is the only currency this system has (`MONEY-MODEL.md`), and the Arabic
 * form is here so that adding a translated template does not silently open a
 * door. Word-bounded, or `EGP` inside an identifier like `formatEGP` would
 * match.
 */
const CURRENCY = /\bEGP\b|ج\.م/;

/**
 * A value being rendered near the token: any brace or interpolation marker.
 *
 * Deliberately looser than `${`. The first version of this rule required an
 * OPENING interpolation on the same line, and it missed
 * `ProductTable.money()` — a multi-line template literal whose currency sits on
 * the closing line, `})} EGP\``, with the interpolation two lines above. The
 * stale-allowance check is what surfaced that: the exemption written for it
 * stopped matching, which is precisely the rot that check exists to catch, and
 * it caught it on the first run.
 *
 * Looser means more legitimate hits, and legitimate hits are cheap — each is
 * one entry with a reason. A missed defect is not.
 */
const EXPRESSION = /[${}]/;

interface Finding {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

/**
 * One allowed finding.
 *
 * Keyed by file and a SUBSTRING of the line rather than a line number, because
 * a line number is stale the moment anything above it is edited — and a stale
 * key silently stops matching, which turns a checked exemption into an
 * unchecked one.
 */
interface Allowance {
  readonly file: string;
  readonly snippet: string;
  readonly why: string;
}

const ALLOWED: readonly Allowance[] = [
  {
    file: 'apps/admin/src/components/products/ProductTable.tsx',
    snippet: '})} EGP`',
    why:
      'The admin product DTO returns pricing as raw integers ON PURPOSE — an editor round-trips ' +
      'the value it posts back, and passing it through a display format and back is where a ' +
      'separator or a rounding rule gets to change the number. So this screen is the one place ' +
      'that must format money itself. It divides by 100 exactly once, in one helper.',
  },
  {
    file: 'apps/admin/src/components/coupons/CouponsTable.tsx',
    snippet: 'EGP ${coupon.value.toLocaleString',
    why:
      'Supabase coupons, a Phase 8 domain the API has no model for. The value is a Postgres ' +
      'numeric in major units, so the arithmetic is right; the screen already says on it that ' +
      'no coupon here can be redeemed. It moves when the domain is rebuilt.',
  },
  {
    file: 'apps/storefront/src/components/FilterSidebar.tsx',
    snippet: 'EGP {localMin.toLocaleString()}',
    why: 'A filter bound the customer typed, in pounds. Not a server amount.',
  },
  {
    file: 'apps/storefront/src/components/FilterSidebar.tsx',
    snippet: 'EGP {localMax.toLocaleString()}',
    why: 'A filter bound the customer typed, in pounds. Not a server amount.',
  },
  {
    file: 'apps/storefront/src/components/FilterSidebar.tsx',
    snippet: "`EGP ${params.min_price}`",
    why: 'The active-filter chip for the bound above. Major units, from the URL.',
  },
  {
    file: 'apps/storefront/src/components/FilterSidebar.tsx',
    snippet: "`EGP ${params.max_price}`",
    why: 'The active-filter chip for the bound above. Major units, from the URL.',
  },
  {
    file: 'apps/storefront/src/app/products/(listing)/page.tsx',
    snippet: '`EGP ${parsedParams.min_price}`',
    why:
      'The listing page documents the unit at the top of the file: `?min_price=100` means ' +
      '100.00 EGP, and it multiplies by 100 at the API boundary. Rendering the number the ' +
      'customer typed is correct.',
  },
  {
    file: 'apps/storefront/src/actions/cart-view.actions.ts',
    snippet: "formatted: '0.00 EGP'",
    why:
      'Constructing an empty `Money` for an empty cart. The literal IS the `formatted` field ' +
      'this rule exists to promote, not a hand-formatted amount.',
  },
  {
    file: 'apps/storefront/src/app/products/[slug]/page.tsx',
    snippet: '{formatPrice(product.salePrice)} <span className="text-xl font-bold">EGP</span>',
    why:
      'Arithmetically correct — the view model divides by 100 — but it re-derives what ' +
      '`Money.formatted` already says, and its `formatPrice` is `Math.round`, so 149.99 EGP ' +
      'renders as "150 EGP". REPORTED, NOT FIXED: this file has uncommitted work in it that ' +
      'this session was asked not to touch. It is named here so the exemption is a to-do with ' +
      'an owner rather than a permanent blessing.',
  },
  {
    file: 'apps/storefront/src/app/products/[slug]/page.tsx',
    snippet: '{formatPrice(product.basePrice)} EGP',
    why: 'Same file, same rounding defect, same reason for being reported rather than fixed.',
  },
  {
    file: 'apps/storefront/src/app/products/[slug]/page.tsx',
    snippet: '{formatPrice(product.basePrice)} <span className="text-xl font-bold">EGP</span>',
    why: 'Same file, same rounding defect, same reason for being reported rather than fixed.',
  },
];

function sourceFiles(root: string): string[] {
  const absolute = join(REPO_ROOT, root);
  const found: string[] = [];

  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);

      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        walk(path);
        continue;
      }

      if (EXTENSIONS.some((extension) => entry.name.endsWith(extension))) found.push(path);
    }
  };

  walk(absolute);

  return found;
}

/** `true` for a line that is only a comment — prose about money is not money. */
function isComment(line: string): boolean {
  const trimmed = line.trimStart();

  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

function scan(roots: readonly string[]): Finding[] {
  const findings: Finding[] = [];

  for (const root of roots) {
    for (const file of sourceFiles(root)) {
      const lines = readFileSync(file, 'utf8').split(/\r?\n/);

      lines.forEach((text, index) => {
        if (isComment(text)) return;
        if (!CURRENCY.test(text)) return;
        if (!EXPRESSION.test(text)) return;

        findings.push({
          // POSIX separators, so an allowance reads the same on every machine.
          file: relative(REPO_ROOT, file).split(sep).join('/'),
          line: index + 1,
          text: text.trim(),
        });
      });
    }
  }

  return findings;
}

function allowanceFor(finding: Finding): Allowance | undefined {
  return ALLOWED.find(
    (allowed) => allowed.file === finding.file && finding.text.includes(allowed.snippet),
  );
}

describe('money reaches a template formatted, or not at all', () => {
  it('is actually looking at the front ends — not passing on an empty scan', () => {
    /*
     * The worst failure mode of a guard is passing because it found nothing to
     * check. A renamed directory or a changed extension would do it silently,
     * so the file count is asserted rather than assumed.
     */
    const counts = ROOTS.map((root) => sourceFiles(root).length);

    for (const count of counts) expect(count).toBeGreaterThan(20);
  });

  it('detects a planted violation — the canary', () => {
    /*
     * This scanner reports clean on every ordinary run, and a scanner never
     * shown to detect anything is worth nothing. So a real file containing the
     * real defect is written into a real scanned root, and the REAL scan — same
     * function, same roots — must find it.
     *
     * `.tsx` under `src/` rather than under `app/`, so no route is created even
     * for the moment it exists, and removed in `finally`.
     */
    const canary = join(REPO_ROOT, 'apps/admin/src', 'zz-money-guard-canary.tsx');

    writeFileSync(canary, 'export const bad = `EGP ${order.total.amount}`;\n', 'utf8');

    try {
      const found = scan(ROOTS).filter((finding) => finding.file.endsWith('zz-money-guard-canary.tsx'));

      expect(found).toHaveLength(1);
      expect(allowanceFor(found[0] as Finding)).toBeUndefined();
    } finally {
      rmSync(canary, { force: true });
    }
  });

  it('finds no unexplained currency symbol beside a rendered value', () => {
    const unexplained = scan(ROOTS).filter((finding) => allowanceFor(finding) === undefined);

    expect(
      unexplained.map((finding) => `${finding.file}:${String(finding.line)}  ${finding.text}`),
    ).toEqual([]);
  });

  it('has no allowance that has stopped matching anything', () => {
    /*
     * The other direction, and the one that keeps this from rotting.
     *
     * An exemption whose line was deleted or reworded stops matching silently,
     * and what it leaves behind is a blessing with no subject — a hole the next
     * instance of the defect can land in without anybody noticing. So a stale
     * allowance is a failure, and removing it is part of changing the line.
     */
    const findings = scan(ROOTS);

    const stale = ALLOWED.filter(
      (allowed) =>
        !findings.some(
          (finding) => finding.file === allowed.file && finding.text.includes(allowed.snippet),
        ),
    ).map((allowed) => `${allowed.file}  ${allowed.snippet}`);

    expect(stale).toEqual([]);
  });
});
