import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import { Connection, Model, Types } from 'mongoose';
import { AppModule } from '../../src/app.module';
import { appConfig } from '../../src/config/app.config';
import { trackedFilesContaining } from '../../src/common/security/repository-secrets';
import {
  StaffProvisioningError,
  StaffProvisioningService,
} from '../../src/modules/auth/application/staff-provisioning.service';
import { MIN_PASSWORD_LENGTH } from '../../src/modules/auth/domain/password-policy';
import { Role, User, type UserLean } from '../../src/modules/users/infrastructure/schemas/user.schema';
import {
  DEV_ADMIN_EMAIL,
  DEV_ADMIN_PASSWORD,
} from '../../src/database/seed/dev-admin.seed-data';
import { SANDBOX_PASSWORD } from '../../src/database/seed/sandbox.seed-data';

/**
 * Staff provisioning cannot produce a default credential.
 *
 * ## The failure this is built against
 *
 * A command that creates the first administrator is the classic source of a
 * default credential: it takes `--password` with a fallback, prints
 * "admin / ChangeMe123!", and gets run once on every environment including the
 * real one. This engagement has already found the same shape one layer down — a
 * JWT signing key that shipped in `.env.example` and **passed its own
 * validator**, because the placeholder was 57 characters and the rule was "at
 * least 32".
 *
 * The conclusion drawn there is the rule enforced here: **a placeholder nothing
 * rejects is a default.** Length rules and character classes reject nothing;
 * asking whether the value is already written down rejects exactly the values
 * that matter.
 *
 * So every test below is an attempt to get a weak or published credential past
 * the service, and each one must be refused for a NAMED reason. A test that
 * only proved the happy path would be satisfied by a service with no checks at
 * all.
 *
 * ISOLATION: every account created here is tracked by id and removed in
 * `afterAll`. Nothing else is touched.
 */

const RUN_ID = randomUUID().slice(0, 8);
const REPO_ROOT = join(__dirname, '../../../..');

/**
 * A password that is NOT in the repository, built fresh per run.
 *
 * Fresh rather than a constant, because a constant in this file would BE in the
 * repository — this suite is tracked — and the repository check would refuse
 * it. The test that proves the check works uses that fact deliberately, below.
 */
const UNPUBLISHED = `orbital ${RUN_ID} lattice damper`;

let moduleRef: TestingModule;
let service: StaffProvisioningService;
let users: Model<User>;
const createdUserIds: Types.ObjectId[] = [];

/** A unique address per case, so one refusal cannot be a duplicate-email refusal. */
function address(label: string): string {
  return `staff-${label}.${RUN_ID}@provisioning.example`;
}

async function provision(overrides: Partial<Parameters<StaffProvisioningService['provision']>[0]>) {
  const created = await service.provision({
    email: address('default'),
    password: UNPUBLISHED,
    fullName: 'Provisioned Person',
    phone: null,
    role: Role.ADMIN,
    ...overrides,
  });

  createdUserIds.push(created._id);
  return created;
}

/** The refusal, or a failure saying the call was allowed through. */
async function refusalOf(
  overrides: Partial<Parameters<StaffProvisioningService['provision']>[0]>,
): Promise<StaffProvisioningError> {
  try {
    const created = await provision(overrides);

    throw new Error(
      `expected a refusal, but the service created ${created.email} as ${created.role}`,
    );
  } catch (error) {
    if (error instanceof StaffProvisioningError) return error;
    throw error;
  }
}

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  service = moduleRef.get(StaffProvisioningService);
  users = moduleRef.get<Model<User>>(getModelToken(User.name));
}, 120_000);

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await users.deleteMany({ _id: { $in: createdUserIds } }).exec();
  }

  const connection = moduleRef.get<Connection>(getConnectionToken());
  await moduleRef.close();
  await connection.close();
}, 120_000);

// ---------------------------------------------------------------------------

describe('the repository scan actually detects something — the canary', () => {
  /**
   * A scanner that has never been shown to find anything is worth nothing, and
   * this one reports "clean" on every ordinary call. So it is pointed at a
   * value that is definitely committed.
   *
   * `SANDBOX_PASSWORD` is written in `sandbox.seed-data.ts` and in
   * `docs/api/SANDBOX.md`, both tracked. If the scan ever stops finding it —
   * a broken path resolution, a skipped extension, an enumeration that returns
   * nothing — this goes red instead of every provisioning check silently
   * passing.
   */
  it('finds a value that IS committed', () => {
    const found = trackedFilesContaining(SANDBOX_PASSWORD);

    expect(found.length).toBeGreaterThan(0);
    expect(found).toContain('apps/api/src/database/seed/sandbox.seed-data.ts');
  });

  it('finds nothing for a value that is not', () => {
    expect(trackedFilesContaining(`absent-${randomUUID()}`)).toEqual([]);
  });

  it('reads real file contents rather than only file names', () => {
    // A scan that matched on paths would find the seed file for "sandbox" and
    // would find nothing for a phrase that only appears INSIDE a document.
    const insideADocument = 'a working API on your machine, with a catalogue';

    expect(readFileSync(join(REPO_ROOT, 'docs/api/SANDBOX.md'), 'utf8')).toContain(insideADocument);
    expect(trackedFilesContaining(insideADocument)).toContain('docs/api/SANDBOX.md');
  });
});

describe('no default password can get through', () => {
  it('refuses a password that appears anywhere in this repository', async () => {
    /*
     * The sandbox customer's password. It is a perfectly strong passphrase —
     * 23 characters, not in any common-password list, passes the policy
     * outright — and it is published in two tracked files. Length and
     * composition rules accept it; only asking "is this written down?"
     * refuses it.
     */
    const refusal = await refusalOf({ email: address('published'), password: SANDBOX_PASSWORD });

    expect(refusal.reason).toBe('PASSWORD_IN_REPOSITORY');
    expect(refusal.locations.length).toBeGreaterThan(0);
  });

  it('refuses the DEVELOPMENT ADMIN password for a real address', async () => {
    // The fixture password is exempt for a `.test` address and for nothing
    // else. Somebody reusing it for a real staff account is exactly the
    // mistake this prevents.
    const refusal = await refusalOf({ email: address('devpass'), password: DEV_ADMIN_PASSWORD });

    expect(refusal.reason).toBe('PASSWORD_IN_REPOSITORY');
  });

  it('names the files, and never the password itself', async () => {
    const refusal = await refusalOf({ email: address('names'), password: SANDBOX_PASSWORD });

    expect(refusal.locations).toContain('apps/api/src/database/seed/sandbox.seed-data.ts');

    // A refusal that quoted the value would put it in a terminal and a CI log —
    // the same mistake as the Cloudinary key jest once printed on failure.
    expect(refusal.message).not.toContain(SANDBOX_PASSWORD);
    expect(refusal.locations.join(' ')).not.toContain(SANDBOX_PASSWORD);
  });

  it('refuses an empty password', async () => {
    const refusal = await refusalOf({ email: address('empty'), password: '' });

    expect(refusal.reason).toBe('WEAK_PASSWORD');
  });

  it('refuses a short one, and a common one, on the SAME policy a customer faces', async () => {
    const short = await refusalOf({
      email: address('short'),
      password: 'a'.repeat(MIN_PASSWORD_LENGTH - 1),
    });
    expect(short.reason).toBe('WEAK_PASSWORD');

    /*
     * The credential this whole exercise is named after. It is 12 characters,
     * so a length rule alone would let it through.
     */
    const common = await refusalOf({ email: address('common'), password: 'admin123456' });
    expect(common.reason).toBe('WEAK_PASSWORD');
  });

  it('refuses a password containing the account’s own address', async () => {
    const refusal = await refusalOf({
      email: 'operations@provisioning.example',
      password: 'operations-and-then-some-more',
    });

    expect(refusal.reason).toBe('WEAK_PASSWORD');
  });

  it('creates nothing when it refuses', async () => {
    const email = address('nothing-created');

    await refusalOf({ email, password: SANDBOX_PASSWORD });

    expect(await users.findOne({ email }).lean<UserLean>().exec()).toBeNull();
  });
});

describe('what it does create', () => {
  it('creates a staff account that is usable immediately', async () => {
    const created = await provision({ email: address('admin'), role: Role.ADMIN });

    expect(created.role).toBe(Role.ADMIN);
    // Verified at creation: there is no mail flow for an account an operator
    // provisions, and an unverified admin cannot sign in.
    expect(created.emailVerifiedAt).not.toBeNull();
    expect(created.emailVerification).toBeNull();
    expect(created.deletedAt).toBeNull();
  });

  it('stores a HASH and never the password', async () => {
    const created = await provision({ email: address('hashed') });

    const stored = await users.findById(created._id).lean<UserLean>().exec();

    expect(stored?.passwordHash).toBeDefined();
    expect(stored?.passwordHash).not.toBe(UNPUBLISHED);
    expect(stored?.passwordHash.startsWith('$2')).toBe(true);
  });

  it('normalises the address, so one person cannot become two accounts', async () => {
    const created = await provision({ email: `  MiXeD.${RUN_ID}@Provisioning.Example  ` });

    expect(created.email).toBe(`mixed.${RUN_ID}@provisioning.example`);
  });

  it('refuses a duplicate address at the DATABASE, not by a racy pre-check', async () => {
    const email = address('duplicate');

    await provision({ email });

    // The unique index is what serialises two concurrent attempts; a
    // `findOne` first would let both pass. The refusal here is that index
    // speaking, translated.
    await expect(provision({ email })).rejects.toMatchObject({
      code: 'DUPLICATE_EMAIL',
    });
  });

  it('refuses to provision a CUSTOMER — registration does that', async () => {
    const refusal = await refusalOf({
      email: address('customer'),
      role: Role.CUSTOMER as unknown as Role.ADMIN,
    });

    expect(refusal.reason).toBe('NOT_A_STAFF_ROLE');
  });
});

describe('the production rules', () => {
  /**
   * Production is simulated by rebuilding the module with `nodeEnv` overridden.
   *
   * The alternative — setting `process.env.NODE_ENV` — would be read by the env
   * schema at import time and would leak into every other suite in the worker.
   * Overriding the config provider changes exactly the value under test.
   */
  async function inProduction(): Promise<{ service: StaffProvisioningService; close: () => Promise<void> }> {
    const base = moduleRef.get(appConfig.KEY) as Record<string, unknown>;

    const productionModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(appConfig.KEY)
      .useValue({ ...base, nodeEnv: 'production' })
      .compile();

    return {
      service: productionModule.get(StaffProvisioningService),
      close: async () => {
        const connection = productionModule.get<Connection>(getConnectionToken());
        await productionModule.close();
        await connection.close();
      },
    };
  }

  it('refuses a reserved .test address in production', async () => {
    const production = await inProduction();

    try {
      await expect(
        production.service.provision({
          email: DEV_ADMIN_EMAIL,
          password: UNPUBLISHED,
          fullName: 'Development Admin',
          phone: null,
          role: Role.SUPER_ADMIN,
        }),
      ).rejects.toMatchObject({ reason: 'RESERVED_DOMAIN_IN_PRODUCTION' });
    } finally {
      await production.close();
    }
  }, 120_000);

  it('refuses a SECOND super-admin in production unless told', async () => {
    const production = await inProduction();

    try {
      /*
       * The development database already has super-admins from other suites and
       * from `dev-admin:seed`, which is the state this rule is about: a re-run
       * of a provisioning command must not quietly grant the most privileged
       * role again.
       */
      const seeded = await provision({ email: address('first-super'), role: Role.SUPER_ADMIN });
      expect(seeded.role).toBe(Role.SUPER_ADMIN);

      await expect(
        production.service.provision({
          email: address('second-super'),
          password: UNPUBLISHED,
          fullName: 'Second Super',
          phone: null,
          role: Role.SUPER_ADMIN,
        }),
      ).rejects.toMatchObject({ reason: 'SUPER_ADMIN_EXISTS' });

      // ...and the refusal is loud, not absolute. Saying so explicitly works.
      const acknowledged = await production.service.provision({
        email: address('acknowledged-super'),
        password: UNPUBLISHED,
        fullName: 'Acknowledged Super',
        phone: null,
        role: Role.SUPER_ADMIN,
        acknowledgeExistingSuperAdmin: true,
      });

      createdUserIds.push(acknowledged._id);
      expect(acknowledged.role).toBe(Role.SUPER_ADMIN);
    } finally {
      await production.close();
    }
  }, 120_000);

  it('does NOT interrogate a developer about a second super-admin outside production', async () => {
    // Two in a row, no acknowledgement, no refusal. The rule is about
    // production; applying it locally would only train people to pass the flag
    // by reflex, which is how an acknowledgement stops meaning anything.
    const first = await provision({ email: address('local-super-a'), role: Role.SUPER_ADMIN });
    const second = await provision({ email: address('local-super-b'), role: Role.SUPER_ADMIN });

    expect([first.role, second.role]).toEqual([Role.SUPER_ADMIN, Role.SUPER_ADMIN]);
  });
});
