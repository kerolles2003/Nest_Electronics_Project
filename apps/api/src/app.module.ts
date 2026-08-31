import { Module, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { RequestIdInterceptor } from './common/interceptors/request-id.interceptor';
import { validationExceptionFactory } from './common/pipes/validation-exception.factory';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { AppThrottlerGuard } from './modules/auth/guards/app-throttler.guard';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from './modules/auth/guards/roles.guard';
import { CartModule } from './modules/cart/cart.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { FulfilmentModule } from './modules/fulfilment/fulfilment.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { OrdersModule } from './modules/orders/orders.module';
import { UsersModule } from './modules/users/users.module';

/**
 * The composition root — the only file that knows the full module list.
 *
 * Authority: docs/architecture/CODEBASE-STRUCTURE.md §2.1;
 *            docs/architecture/AUTHORIZATION-MODEL.md §1 (the pipeline).
 */
@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    /**
     * One throttler, overridden per route with `@Throttle({ global: … })`.
     *
     * The default is the frozen authenticated allowance (300/min). The frozen
     * table also specifies a lower anonymous allowance (100/min), which is NOT
     * applied here for a reason worth stating: telling the two apart requires
     * the principal, the principal requires the auth guard to have run, and
     * running the throttler after the auth guard would leave every rejected
     * token unthrottled — which is exactly the traffic worth throttling. The
     * abuse-sensitive endpoints carry their own explicit, much tighter limits,
     * which is where the real protection is.
     *
     * Storage is in-memory: correct for one instance, silently wrong for more
     * than one. That is the documented Redis trigger (REDIS-DECISION.md §4).
     */
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'global', ttl: 60_000, limit: 300 }],
    }),
    HealthModule,
    UsersModule,
    AuthModule,
    CatalogModule,
    CartModule,
    InventoryModule,
    FulfilmentModule,
    OrdersModule,
  ],
  providers: [
    {
      // Correlation runs first so every later log line and error carries the id.
      provide: APP_INTERCEPTOR,
      useClass: RequestIdInterceptor,
    },
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
    /**
     * GUARD ORDER IS LOAD-BEARING. Guards run in registration order.
     *
     *   1. Throttler   — before authentication, so a flood of invalid tokens is
     *                    rate-limited rather than merely rejected 401 at speed.
     *   2. JwtAuthGuard — authentication, GLOBAL BY DEFAULT. A new controller is
     *                    protected the moment it is written; `@Public()` is the
     *                    explicit opt-out. Forgetting it makes a route
     *                    inaccessible, not unprotected.
     *   3. RolesGuard  — authorization, once there is a principal to authorize.
     */
    // Bound with `useExisting` rather than `useClass` so each guard also has a
    // provider under its own token. That is what lets a test replace ONE of
    // them — the functional auth suite disables throttling without touching
    // authentication, which a bare APP_GUARD registration makes impossible.
    AppThrottlerGuard,
    JwtAuthGuard,
    RolesGuard,
    { provide: APP_GUARD, useExisting: AppThrottlerGuard },
    { provide: APP_GUARD, useExisting: JwtAuthGuard },
    { provide: APP_GUARD, useExisting: RolesGuard },
    {
      // forbidNonWhitelisted is a SECURITY control, not a convenience: it is what
      // makes `role`, `stock`, `userId` and `price` injection structurally
      // impossible.
      // Authority: docs/architecture/API-STANDARDS.md §4 — "non-negotiable".
      //
      // enableImplicitConversion stays FALSE: implicit coercion would turn
      // "quantity": "-5" into a number silently. DTOs opt in per field with
      // @Type, so every conversion is deliberate and visible.
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: false },
        exceptionFactory: validationExceptionFactory,
      }),
    },
  ],
})
export class AppModule {}
