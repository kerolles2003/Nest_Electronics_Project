import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';
import { AppModule } from '../../app.module';
import { appConfig, type AppConfig } from '../../config/app.config';
import {
  StaffProvisioningError,
  StaffProvisioningService,
} from '../../modules/auth/application/staff-provisioning.service';
import { Role, User, type UserLean } from '../../modules/users/infrastructure/schemas/user.schema';
import {
  DEV_ADMIN_EMAIL,
  DEV_ADMIN_FULL_NAME,
  DEV_ADMIN_PASSWORD,
  DEV_ADMIN_PHONE,
} from './dev-admin.seed-data';

/**
 * The development admin.
 *
 *   pnpm --filter api dev-admin:seed
 *
 * ## Why this exists alongside `staff:create`
 *
 * `staff:create` is the real command: interactive, no default password, refuses
 * anything written down. That is exactly right for provisioning a person, and
 * exactly wrong for the fifteenth time you drop your local database — a
 * developer who has to answer three prompts to get back to a working admin
 * screen will instead write a `db.users.updateOne({}, {$set:{role:'ADMIN'}})`
 * into a scratch file and use that forever, which is a worse outcome than a
 * documented fixture.
 *
 * So this is one command with no questions, holding the same bargain the
 * sandbox customer holds: a published password on a reserved `.test` address
 * that refuses to exist in production.
 *
 * ## It goes through the SAME service, and is refused by the same rules
 *
 * It calls `StaffProvisioningService.provision`, not the repository. So the
 * password documented in `SANDBOX.md` is provably one the real policy accepts —
 * a seed that wrote a hash directly could document a password that provisioning
 * itself would reject — and every guard that protects `staff:create` protects
 * this too. The ONE rule it is exempt from is the repository-appearance check,
 * and it is exempt only because its address ends in `.test`, which production
 * refuses outright one check earlier.
 *
 * ## Idempotent
 *
 * Re-running converges: an existing account is repaired — role restored,
 * re-verified, un-deleted — rather than duplicated. `--reset` removes it and
 * its sessions so the creation path itself can be exercised.
 */

const logger = new Logger('DevAdminSeed');

interface Services {
  readonly staff: StaffProvisioningService;
  readonly users: Model<User>;
  readonly connection: Connection;
}

/**
 * Removes the account and its sessions. Only ever this one address.
 *
 * No broad delete, no `{role: 'SUPER_ADMIN'}` filter — a reset that removed
 * every super-admin would be a very effective way to lose a real one on a
 * machine pointed at the wrong database.
 */
async function resetTheAccount(services: Services): Promise<void> {
  const existing = await services.users
    .findOne({ email: DEV_ADMIN_EMAIL })
    .lean<UserLean>()
    .exec();

  if (existing === null) {
    logger.log('reset       no development admin yet — nothing to undo');
    return;
  }

  await services.connection.collection('refreshTokens').deleteMany({ userId: existing._id });
  await services.users.deleteOne({ _id: existing._id }).exec();

  logger.log('reset       development admin and its sessions removed');
}

/**
 * Repairs an account that has drifted.
 *
 * Repair matters more than creation. A developer will demote this account while
 * testing the roles guard, soft-delete it, or un-verify it — and the fix has to
 * be "run the command again" rather than "work out what is different". The
 * password is deliberately NOT reset here: it is already the documented one,
 * and rewriting a hash outside the provisioning service would be the one place
 * in this file that skipped the policy.
 */
async function repair(services: Services, existing: UserLean): Promise<void> {
  await services.users
    .updateOne(
      { _id: existing._id },
      {
        $set: {
          role: Role.SUPER_ADMIN,
          emailVerifiedAt: existing.emailVerifiedAt ?? new Date(),
          emailVerification: null,
          deletedAt: null,
          fullName: DEV_ADMIN_FULL_NAME,
        },
      },
    )
    .exec();

  logger.log('account     already present — role, verification and name restored');
  logger.log('            the password is unchanged; use --reset to recreate it');
}

/**
 * @param reset  Recreate the account even if one is already there. Taken as a
 *               parameter rather than read from `process.argv` inside, because
 *               the scratch-database harness calls this in a process whose
 *               arguments belong to something else entirely.
 */
export async function seedDevelopmentAdmin(reset = false): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const config = app.get<AppConfig>(appConfig.KEY);

    if (config.nodeEnv === 'production') {
      /*
       * The whole point of this account is that its password is written in a
       * document anyone can read. `StaffProvisioningService` would refuse the
       * `.test` address here anyway; this refuses earlier and says why, so the
       * message names the reason rather than the mechanism.
       */
      throw new Error(
        'refusing to seed a development admin: NODE_ENV=production. Provision a real ' +
          'account instead: pnpm --filter api staff:create -- --help',
      );
    }

    const services: Services = {
      staff: app.get(StaffProvisioningService),
      users: app.get<Model<User>>(getModelToken(User.name)),
      connection: app.get<Connection>(getConnectionToken()),
    };

    if (reset) {
      await resetTheAccount(services);
    }

    const existing = await services.users
      .findOne({ email: DEV_ADMIN_EMAIL })
      .lean<UserLean>()
      .exec();

    if (existing !== null) {
      await repair(services, existing);
    } else {
      await services.staff.provision({
        email: DEV_ADMIN_EMAIL,
        password: DEV_ADMIN_PASSWORD,
        fullName: DEV_ADMIN_FULL_NAME,
        phone: DEV_ADMIN_PHONE,
        role: Role.SUPER_ADMIN,
      });

      logger.log('account     created through the real provisioning service');
    }

    logger.log(`development admin ready: ${DEV_ADMIN_EMAIL}`);
    logger.log('the password is in docs/api/SANDBOX.md — it is a local fixture, not a secret');
  } finally {
    const connection = app.get<Connection>(getConnectionToken());
    await app.close();
    await connection.close();
  }
}

/*
 * The CLI half, kept separate from the operation above.
 *
 * The scratch-database harness rebuilds a database by CALLING these functions,
 * so a failure has to reach the caller as an exception rather than as an exit
 * code nobody reads. The same split as `staff.provision.ts` and its CLI.
 */
if (require.main === module) {
  void seedDevelopmentAdmin(process.argv.includes('--reset')).catch((error: unknown) => {
    if (error instanceof StaffProvisioningError) {
      logger.error(`refused (${error.reason}): ${error.message}`);
    } else {
      logger.error(
        `development admin seed failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    process.exitCode = 1;
  });
}
