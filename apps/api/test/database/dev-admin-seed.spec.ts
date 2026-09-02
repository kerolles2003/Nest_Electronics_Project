import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEV_ADMIN_EMAIL,
  DEV_ADMIN_FULL_NAME,
  DEV_ADMIN_PASSWORD,
  DEV_ADMIN_ROLE,
} from '../../src/database/seed/dev-admin.seed-data';
import { SANDBOX_PASSWORD } from '../../src/database/seed/sandbox.seed-data';
import { validatePassword } from '../../src/modules/auth/domain/password-policy';
import { Role } from '../../src/modules/users/infrastructure/schemas/user.schema';

/**
 * The development admin's credentials are a promise made in a document.
 *
 * `docs/api/SANDBOX.md` §4a tells a developer to sign in to the admin console
 * with a specific email and password, and a document is exactly the thing that
 * drifts: somebody changes the seed, the docs still say the old value, and the
 * first thing the next person does is fail to log in and conclude the admin app
 * is broken. Nothing else in the repository would notice.
 *
 * This is the same guard `sandbox-seed.spec.ts` puts on the customer account,
 * applied to the account that can move money. It also checks the things that
 * make a published password ACCEPTABLE — the reserved domain, the production
 * refusal, the absence of a second copy of the value — because those are what
 * separate a documented fixture from a default credential, and they are exactly
 * what erodes quietly.
 *
 * No database, no network. Milliseconds, and it fails on the commit that breaks
 * it rather than on the afternoon somebody follows the guide.
 */

const REPO_ROOT = join(__dirname, '../../../..');
const SANDBOX_DOC = join(REPO_ROOT, 'docs/api/SANDBOX.md');
const SEED = join(REPO_ROOT, 'apps/api/src/database/seed/dev-admin.seed.ts');
const PACKAGE_JSON = join(REPO_ROOT, 'apps/api/package.json');

const doc = readFileSync(SANDBOX_DOC, 'utf8');
const seed = readFileSync(SEED, 'utf8');

describe('the documented development admin is the seeded one', () => {
  it('SANDBOX.md names the email the seed creates', () => {
    expect(doc).toContain(DEV_ADMIN_EMAIL);
  });

  it('SANDBOX.md names the password the seed sets', () => {
    expect(doc).toContain(DEV_ADMIN_PASSWORD);
  });

  it('SANDBOX.md names the role the seed grants', () => {
    // A doc that promised SUPER_ADMIN while the seed granted ADMIN would send
    // somebody hunting for a missing screen rather than a missing role.
    expect(DEV_ADMIN_ROLE).toBe(Role.SUPER_ADMIN);
    expect(doc).toContain(DEV_ADMIN_ROLE);
  });

  it('documents commands that package.json actually defines', () => {
    const scripts = (JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')) as {
      scripts: Record<string, string>;
    }).scripts;

    for (const command of ['dev-admin:seed', 'staff:create']) {
      expect(Object.keys(scripts)).toContain(command);
      expect(doc).toContain(`pnpm --filter api ${command}`);
    }
  });

  it('documents the reset flag the seed actually implements', () => {
    // Parsed by `process.argv.includes('--reset')`. A doc teaching a different
    // flag would mean reset silently did nothing and re-converged, which looks
    // exactly like it worked.
    expect(seed).toContain("process.argv.includes('--reset')");
    expect(doc).toContain('-- --reset');
  });
});

describe('the fences that make a published password acceptable', () => {
  it('offers a password the provisioning service would itself accept', () => {
    /*
     * The seed creates the account through `StaffProvisioningService`, so a
     * password the policy rejects would fail the seed rather than silently
     * documenting an unusable one. This asserts the same thing one layer
     * earlier and without a database, so the failure names the cause.
     */
    expect(validatePassword(DEV_ADMIN_PASSWORD, DEV_ADMIN_EMAIL)).toBeNull();
  });

  it('uses a reserved test domain, so the address can never receive mail', () => {
    // RFC 2606: `.test` is reserved and unresolvable. This is also the ONE
    // condition under which the provisioning service tolerates a password that
    // appears in the repository, so it is load-bearing twice over.
    expect(DEV_ADMIN_EMAIL).toMatch(/\.test$/);
  });

  it('refuses to run under NODE_ENV=production', () => {
    /*
     * Asserted against the seed's SOURCE rather than by running it, because
     * running it would need a database and a production-shaped environment.
     * The behaviour is proven properly in
     * `test/auth/staff-provisioning.spec.ts`, which drives the service with
     * `nodeEnv` overridden; this is the cheap check that the seed's own guard
     * has not been deleted.
     */
    expect(seed).toContain("config.nodeEnv === 'production'");
    expect(seed).toMatch(/refusing to seed a development admin/);
    expect(doc).toContain('It refuses `NODE_ENV=production`');
  });

  it('goes through the real provisioning service and never writes a hash itself', () => {
    // A seed that hashed a password directly could document one the policy
    // would reject — and would skip every guard that protects `staff:create`.
    expect(seed).toContain('services.staff.provision(');
    expect(seed).not.toMatch(/passwordHash/);
  });

  it('does not reuse the sandbox customer’s password', () => {
    // Two fixtures sharing one password teaches the habit of reusing one, and
    // makes a leak of either a leak of both.
    expect(DEV_ADMIN_PASSWORD).not.toBe(SANDBOX_PASSWORD);
  });

  it('is a distinct account from the sandbox customer', () => {
    expect(DEV_ADMIN_FULL_NAME).not.toBe('Sandbox Customer');
    expect(DEV_ADMIN_EMAIL).not.toBe('sandbox@nest-electronics.test');
  });
});

describe('the documentation says the provisioning command has no default password', () => {
  /**
   * The claim in §4a is a security promise, and a promise in prose is the kind
   * that rots. These pin the three sentences that carry it against the code
   * that has to keep being true.
   */
  it('tells the reader there is no --password argument', () => {
    expect(doc).toContain('There is no `--password`, and there is no default.');
  });

  it('does not print a credential for the real command anywhere', () => {
    /*
     * Bounded at the next top-level heading. The fixture passwords appear
     * elsewhere in this document ON PURPOSE — §4 and §4a hand them to you, and
     * §6 uses one in a registration example — so an unbounded slice would be
     * asserting something the document is not trying to be.
     */
    const start = doc.indexOf('### A real staff account');
    const end = doc.indexOf('\n## ', start);
    const section = doc.slice(start, end === -1 ? undefined : end);

    expect(section).toContain('staff:create');

    // Neither fixture password may appear in the section about provisioning a
    // real person — not as an example, not as a contrast, not at all.
    expect(section).not.toContain(DEV_ADMIN_PASSWORD);
    expect(section).not.toContain(SANDBOX_PASSWORD);
  });

  it('names the repository scan as unskippable', () => {
    expect(doc).toContain('There is no flag to skip the scan');

    const provisioning = readFileSync(
      join(REPO_ROOT, 'apps/api/src/modules/auth/application/staff-provisioning.service.ts'),
      'utf8',
    );

    // And the code has no such flag. A doc saying "unskippable" beside a
    // `--skip` flag is worse than saying nothing.
    expect(provisioning).not.toMatch(/skipRepositoryScan|--skip-repository-scan/);
  });
});
