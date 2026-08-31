import { Inject, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import { authConfig, type AuthConfig } from '../../../config/auth.config';

/**
 * Password hashing and verification. The only place bcrypt is called.
 *
 * Authority: docs/architecture/AUTHORIZATION-MODEL.md §2.2 — bcrypt, cost 12.
 * argon2id is marginally stronger but adds a native build dependency for no
 * practical gain at this scale, and the cost factor is centrally controlled
 * through the configuration boundary rather than scattered as a literal.
 */
@Injectable()
export class PasswordService {
  /**
   * A hash of a random string, computed once at boot at the CONFIGURED cost.
   *
   * Its only purpose is timing equalisation: when login is given an unknown
   * email there is no stored hash to compare against, so a naive implementation
   * returns immediately while a real account costs ~250 ms of bcrypt. That
   * difference is measurable over a handful of requests and turns login into an
   * account-existence oracle regardless of how carefully the response bodies are
   * matched. Comparing against this hash makes both paths cost the same.
   *
   * It is generated rather than hard-coded so it always matches the configured
   * round count, and so no fixed hash ever appears in source.
   *
   * Held as a PROMISE created in the constructor rather than assigned in an
   * `onModuleInit` hook. The difference is not stylistic: if the hook had not
   * run, the field would still be an empty string, `bcrypt.compare` would
   * reject it instantly, and the timing defence would be silently gone — a
   * security control that fails open without any error.
   */
  private readonly dummyHash: Promise<string>;

  constructor(@Inject(authConfig.KEY) private readonly config: AuthConfig) {
    this.dummyHash = bcrypt.hash(randomBytes(32).toString('hex'), config.bcryptRounds);
  }

  async hash(plaintext: string): Promise<string> {
    return bcrypt.hash(plaintext, this.config.bcryptRounds);
  }

  async verify(plaintext: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plaintext, hash);
  }

  /**
   * Burns the same time a real verification would, and always fails.
   * Called on the unknown-email path so it is indistinguishable from a wrong
   * password.
   */
  async verifyAgainstDummy(plaintext: string): Promise<void> {
    await bcrypt.compare(plaintext, await this.dummyHash);
  }
}
