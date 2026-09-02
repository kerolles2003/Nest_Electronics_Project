import { NestFactory } from '@nestjs/core';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { AppModule } from '../../app.module';
import { appConfig, type AppConfig } from '../../config/app.config';
import {
  StaffProvisioningError,
  StaffProvisioningService,
} from '../../modules/auth/application/staff-provisioning.service';

/**
 * Creates ONE staff account, interactively.
 *
 *   pnpm --filter api staff:create -- --email a@b.com --name "Full Name" --role SUPER_ADMIN
 *
 * ## Why this exists
 *
 * Nothing could mint the first `SUPER_ADMIN`. Registration hard-codes
 * `Role.CUSTOMER` and there is no endpoint, no DTO field and no flag that
 * produces a staff account — correctly, because a self-service path to admin is
 * a vulnerability. So the shop could not be operated at all until somebody
 * edited the database by hand, which is the worst of both worlds: undocumented,
 * unvalidated, and impossible to review.
 *
 * ## Why it is deliberately awkward
 *
 * This is the exact shape of command that produces a default credential. The
 * usual version takes a `--password` argument with a fallback, prints "created
 * admin@example.com / ChangeMe123!" and is run once on every environment
 * including the real one. This engagement has already found a signing key that
 * shipped in `.env.example` and passed its own validator because the
 * placeholder was long enough.
 *
 * So the friction is the feature:
 *
 *  1. **The password is never an argument.** It is typed, twice, at a prompt
 *     with no echo. A command-line argument is visible in `ps`, in shell
 *     history and in CI logs, and an argument is a thing that can be given a
 *     default. A prompt cannot.
 *  2. **There is no default and none is generated.** No password, no fallback
 *     email, no fallback name. Every one of them is refused when missing.
 *  3. **It names the account and waits.** The email, the name and the ROLE are
 *     printed and the operator retypes the email to proceed. A confirmation
 *     that takes a `y` is one keystroke from an accident; retyping the address
 *     is not.
 *  4. **The password is checked against the repository** and refused if it is
 *     written down anywhere in it (`StaffProvisioningService`).
 *  5. **In production a second super-admin is refused** unless the operator
 *     says so explicitly.
 *
 * ## It prints no credential, ever
 *
 * Not the password, not a generated one, not a "temporary" one. The person who
 * typed it is the only person who knows it, which is the only arrangement in
 * which nobody has to be trusted to rotate it afterwards.
 */

import {
  complain,
  confirm,
  openPrompter,
  parse,
  readPassword,
  say,
  type Options,
} from './staff-provision.cli';

async function main(): Promise<void> {
  let options: Options;

  try {
    options = parse(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  try {
    const config = app.get<AppConfig>(appConfig.KEY);

    const prompt = openPrompter();
    let password: string;

    try {
      if (!(await confirm(prompt, options, config.nodeEnv))) {
        complain('aborted — the address did not match. Nothing was created.');
        process.exitCode = 1;
        return;
      }

      password = await readPassword(prompt);
    } finally {
      // Closed before anything touches the database, so a refusal below cannot
      // leave the process holding stdin open.
      prompt.close();
    }

    /*
     * Resolved from the application container even though AuthModule does not
     * EXPORT it: `app.get` on an application context searches every module by
     * default. That is the right amount of access for a script running on the
     * operator's own machine, and it keeps the service unreachable from any
     * other module's injector — which is what stops an HTTP route ever
     * acquiring the ability to mint an admin.
     */
    const staff = app.get(StaffProvisioningService);

    const created = await staff.provision({
      email: options.email,
      password,
      fullName: options.fullName,
      phone: options.phone,
      role: options.role,
      acknowledgeExistingSuperAdmin: options.acknowledgeExistingSuperAdmin,
    });

    // The email and the role. NEVER the password — not even a masked hint.
    say('');
    say(`created ${created.role}  ${created.email}`);
    say('the password was hashed, never stored in the clear, and never printed');
  } catch (error) {
    if (error instanceof StaffProvisioningError) {
      complain(`refused (${error.reason}): ${error.message}`);

      for (const location of error.locations) {
        // The FILE, never the value.
        complain(`  found in: ${location}`);
      }
    } else {
      complain(
        `staff provisioning failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    process.exitCode = 1;
  } finally {
    const connection = app.get<Connection>(getConnectionToken());
    await app.close();
    await connection.close();
  }
}

void main();
