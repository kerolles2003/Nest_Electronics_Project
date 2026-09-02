import { ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  ThrottlerStorage,
  type ThrottlerLimitDetail,
  type ThrottlerModuleOptions,
  type ThrottlerRequest,
} from '@nestjs/throttler';
import type { Response } from 'express';
import { throttleConfig, type ThrottleConfig } from '../../../config/throttle.config';
import { THROTTLE_BY_EMAIL_KEY } from '../../../common/decorators/throttle-by-email.decorator';
import { AppException } from '../../../common/errors/app.exception';

/**
 * Rate limiting, with the two adjustments the frozen policy requires.
 *
 * Authority: docs/architecture/AUTHORIZATION-MODEL.md §7. Legacy had no rate
 * limiting anywhere, and its only "limiter" was in-memory client state reset by
 * a page reload.
 *
 * 1. `@ThrottleByEmail()` routes are keyed by IP **and** email — see that
 *    decorator for why the distinction matters.
 * 2. A rejection uses the project's error envelope. The library throws its own
 *    exception shape, which would be a second response format — exactly what
 *    the single envelope exists to prevent.
 * 3. Every declared limit passes through one multiplier, so a test environment
 *    can raise the ceiling without any route's number being rewritten and
 *    without the guard being switched off. See `config/throttle.config.ts`.
 *
 * Storage is in-memory, which is correct for ONE instance and silently wrong
 * for more than one: with N instances the effective limit becomes N × the
 * configured value. That is the documented Redis trigger (REDIS-DECISION.md §4)
 * and swapping the store is a configuration change, not a refactor.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  /*
   * The base class's own parameter decorators are not inherited, so its two
   * library-internal tokens have to be named again here. They are the same
   * ones it uses; the only new parameter is the last.
   */
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    @Inject(throttleConfig.KEY) private readonly throttle: ThrottleConfig,
  ) {
    super(options, storageService, reflector);
  }

  /**
   * Applies the one multiplier to whatever limit the route declared.
   *
   * `requestProps.limit` is already resolved from the route's `@Throttle`
   * metadata, so this is the single point every limit in the API passes
   * through — which is what makes relaxing them for a test run one decision
   * rather than an env var per endpoint. The multiplier is 1 in every normal
   * process, and the schema refuses to let it be anything else in production.
   */
  protected handleRequest(requestProps: ThrottlerRequest): Promise<boolean> {
    return super.handleRequest({
      ...requestProps,
      limit: requestProps.limit * this.throttle.limitMultiplier,
    });
  }

  protected generateKey(context: ExecutionContext, suffix: string, name: string): string {
    const base = super.generateKey(context, suffix, name);

    const byEmail = this.reflector.getAllAndOverride<boolean>(THROTTLE_BY_EMAIL_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (byEmail !== true) {
      return base;
    }

    // `suffix` is already the IP-derived tracker, so this yields an IP+email
    // key. Lowercased so one address cannot get several budgets by changing
    // case, and truncated because it is attacker-controlled and lands in a
    // storage key.
    const body: unknown = context.switchToHttp().getRequest<{ body?: unknown }>().body;
    const email =
      typeof body === 'object' &&
      body !== null &&
      typeof (body as { email?: unknown }).email === 'string'
        ? (body as { email: string }).email.trim().toLowerCase().slice(0, 254)
        : '';

    return `${base}:${email}`;
  }

  protected throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    // Frozen requirement: a 429 carries Retry-After, in SECONDS.
    const retryAfterSeconds = Math.max(1, Math.ceil(detail.timeToBlockExpire));
    context.switchToHttp().getResponse<Response>().setHeader('Retry-After', retryAfterSeconds);

    return Promise.reject(AppException.rateLimited());
  }
}
