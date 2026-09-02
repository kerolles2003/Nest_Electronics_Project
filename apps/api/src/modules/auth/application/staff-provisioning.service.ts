import { Inject, Injectable } from '@nestjs/common';
import { appConfig, type AppConfig } from '../../../config/app.config';
import {
  RepositoryNotScannableError,
  trackedFilesContaining,
} from '../../../common/security/repository-secrets';
import { Role, type UserLean } from '../../users/infrastructure/schemas/user.schema';
import { normaliseEmail, validatePassword } from '../domain/password-policy';
import { CredentialRepository } from '../infrastructure/repositories/credential.repository';
import { PasswordService } from './password.service';

/**
 * The reserved domain a development fixture must live on.
 *
 * RFC 2606: `.test` is reserved and unresolvable, so an account on it can never
 * receive mail and can never belong to a real person. The sandbox customer
 * already follows this rule; the dev admin follows the same one.
 */
const RESERVED_TEST_SUFFIX = '.test';

export type StaffProvisioningRefusal =
  /** The role asked for is not a staff role. Customers register; they are not provisioned. */
  | 'NOT_A_STAFF_ROLE'
  /** The password failed the same policy a customer's password faces. */
  | 'WEAK_PASSWORD'
  /** The password is written down in this repository. */
  | 'PASSWORD_IN_REPOSITORY'
  /** The repository could not be read, so "is this password published?" is UNKNOWN. */
  | 'REPOSITORY_NOT_SCANNABLE'
  /** A reserved `.test` address was offered in production. */
  | 'RESERVED_DOMAIN_IN_PRODUCTION'
  /** A super-admin already exists in production and the caller did not say so. */
  | 'SUPER_ADMIN_EXISTS';

export class StaffProvisioningError extends Error {
  constructor(
    readonly reason: StaffProvisioningRefusal,
    message: string,
    /** Where the password was found. Paths only — never the value. */
    readonly locations: readonly string[] = [],
  ) {
    super(message);
    this.name = 'StaffProvisioningError';
  }
}

export interface ProvisionStaffInput {
  readonly email: string;
  /** Supplied by a person. There is no default and none is generated. */
  readonly password: string;
  readonly fullName: string;
  readonly phone: string | null;
  readonly role: Role.ADMIN | Role.SUPER_ADMIN;
  /**
   * The caller has been told a super-admin already exists and means to create
   * another anyway.
   *
   * Only consulted in production, and it exists so that the refusal there is
   * loud rather than absolute: creating a second holder of the most privileged
   * role is a decision somebody should make on purpose, not an idempotent
   * convenience a re-run performs quietly.
   */
  readonly acknowledgeExistingSuperAdmin?: boolean;
}

/**
 * Creates the accounts that operate the shop.
 *
 * Authority: AUTHORIZATION-MODEL.md §3 — three roles, and staff are
 * PROVISIONED. There is no self-service path to `ADMIN`: no endpoint, no DTO
 * field, no registration flag. This service and the two command-line scripts
 * that drive it are the entire surface.
 *
 * ## The one rule everything here exists to enforce
 *
 * **No default password. Ever.**
 *
 * The password is an argument. It is not generated and printed, it is not read
 * from a committed file, and it is not defaulted when omitted — the callers
 * obtain it from a person and this service refuses anything that is already
 * written down.
 *
 * That last clause is the load-bearing one. This engagement found a signing key
 * that shipped in `.env.example` and passed its own validator because the
 * placeholder was long enough, and the lesson generalises: a value nothing
 * rejects IS a default, however impressive it looks. Length rules, character
 * classes and "please change this" comments do not reject anything. Asking
 * whether the value appears in the repository does.
 *
 * ## Why a `.test` address is exempt from that, and why that is safe
 *
 * The development admin seeded for local work has a password written in
 * `dev-admin.seed-data.ts` and in `docs/api/SANDBOX.md` ON PURPOSE — that is
 * what makes it usable, and it is the same bargain the sandbox customer
 * already strikes. So a documented password is permitted for a reserved `.test`
 * address and refused for every other address.
 *
 * The exemption cannot reach production, because production refuses a `.test`
 * address outright, one check earlier. The two rules are a pair: neither is
 * safe alone.
 */
@Injectable()
export class StaffProvisioningService {
  constructor(
    private readonly credentials: CredentialRepository,
    private readonly passwords: PasswordService,
    @Inject(appConfig.KEY) private readonly config: AppConfig,
  ) {}

  /**
   * Creates one staff account, or refuses and says exactly why.
   *
   * The order of the checks matters, and it is cheapest-and-most-fatal first:
   * a `.test` address in production is refused before the password is examined
   * at all, so the repository exemption below is unreachable there.
   */
  async provision(input: ProvisionStaffInput): Promise<UserLean> {
    const email = normaliseEmail(input.email);
    const isProduction = this.config.nodeEnv === 'production';
    const isReservedTestAddress = email.endsWith(RESERVED_TEST_SUFFIX);

    if (input.role !== Role.ADMIN && input.role !== Role.SUPER_ADMIN) {
      throw new StaffProvisioningError(
        'NOT_A_STAFF_ROLE',
        'only ADMIN and SUPER_ADMIN are provisioned; a customer account is created by registration',
      );
    }

    if (isProduction && isReservedTestAddress) {
      throw new StaffProvisioningError(
        'RESERVED_DOMAIN_IN_PRODUCTION',
        `refusing to create ${email} in production: ${RESERVED_TEST_SUFFIX} is a reserved ` +
          'development domain (RFC 2606), it can never receive mail, and the accounts that use ' +
          'it have published passwords',
      );
    }

    const rejection = validatePassword(input.password, email);

    if (rejection !== null) {
      // The policy's own message, which never quotes the password.
      throw new StaffProvisioningError('WEAK_PASSWORD', rejection.message);
    }

    await this.refuseAPublishedPassword(input.password, isReservedTestAddress);
    await this.refuseASilentSecondSuperAdmin(input, isProduction);

    const passwordHash = await this.passwords.hash(input.password);

    return this.credentials.createStaff({
      email,
      passwordHash,
      fullName: input.fullName.trim(),
      phone: input.phone,
      role: input.role,
    });
  }

  // --- the two refusals worth their own explanation ------------------------

  /**
   * Refuses a password that is written down in this repository.
   *
   * ## "Could not look" is not "found nothing"
   *
   * If the repository cannot be enumerated the answer is UNKNOWN, and this
   * refuses. That is the whole point: a check that silently degrades to "clean"
   * when it cannot run is worse than no check, because it reports the same
   * green as a check that actually ran.
   *
   * The cost of being strict is low. Both callers are `pnpm --filter api`
   * scripts, which only work inside a checkout, so the scan always has a tree
   * to read. There is deliberately no flag to skip it — a bypass on a control
   * like this becomes the documented way to run the command.
   */
  private async refuseAPublishedPassword(
    password: string,
    isReservedTestAddress: boolean,
  ): Promise<void> {
    let locations: string[];

    try {
      locations = trackedFilesContaining(password);
    } catch (error) {
      if (error instanceof RepositoryNotScannableError) {
        throw new StaffProvisioningError(
          'REPOSITORY_NOT_SCANNABLE',
          `cannot verify that this password is not already published — ${error.detail}. ` +
            'Run this from a git checkout of the repository. This is refused rather than ' +
            'assumed clean: a password that is written down in a tracked file is a default, ' +
            'and a check that cannot run must not report the same answer as one that did.',
        );
      }

      throw error;
    }

    if (locations.length === 0) return;

    if (isReservedTestAddress) {
      /*
       * The development fixture. Its password is published deliberately, and
       * the address it belongs to is unresolvable and refused in production.
       */
      return;
    }

    throw new StaffProvisioningError(
      'PASSWORD_IN_REPOSITORY',
      `refusing this password: it appears in ${String(locations.length)} tracked file(s) in ` +
        'this repository, so it is published to everybody who can read the code. Choose a ' +
        'value that is not written down anywhere.',
      locations.slice(0, 10),
    );
  }

  /**
   * In production, refuses to add a second super-admin without being told to.
   *
   * Outside production this does not apply at all: a developer re-running a
   * seed, resetting a database or testing the command must not be interrogated
   * about it, and nothing there is privileged.
   *
   * In production the asymmetry is the point. Creating the FIRST super-admin is
   * bootstrapping and has no alternative. Creating another is granting somebody
   * the ability to manage roles and delete accounts, and a command that did it
   * as a side effect of being run twice would make that grant an accident.
   */
  private async refuseASilentSecondSuperAdmin(
    input: ProvisionStaffInput,
    isProduction: boolean,
  ): Promise<void> {
    if (!isProduction || input.role !== Role.SUPER_ADMIN) return;
    if (input.acknowledgeExistingSuperAdmin === true) return;

    const existing = await this.credentials.countByRole(Role.SUPER_ADMIN);

    if (existing === 0) return;

    throw new StaffProvisioningError(
      'SUPER_ADMIN_EXISTS',
      `refusing to create a second SUPER_ADMIN: ${String(existing)} already exist(s). This is ` +
        'the role that manages other roles and deletes accounts, so a second one is a decision ' +
        'and not a re-run. Pass --acknowledge-existing-super-admin if that is what you mean.',
    );
  }
}
