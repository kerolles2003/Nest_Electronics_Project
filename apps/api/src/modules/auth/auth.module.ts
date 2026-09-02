import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { authConfig, type AuthConfig } from '../../config/auth.config';
import { DatabaseModule } from '../../database/database.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { AuthService } from './application/auth.service';
import { EmailVerificationService } from './application/email-verification.service';
import { PasswordResetService } from './application/password-reset.service';
import { PasswordService } from './application/password.service';
import { StaffProvisioningService } from './application/staff-provisioning.service';
import { TokenService } from './application/token.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { CredentialRepository } from './infrastructure/repositories/credential.repository';
import { RefreshTokenRepository } from './infrastructure/repositories/refresh-token.repository';
import { RefreshToken, RefreshTokenSchema } from './infrastructure/schemas/refresh-token.schema';
import { AuthController } from './presentation/auth.controller';

/**
 * Authentication and session lifecycle.
 *
 * Tier 3 — full layering, per CODEBASE-STRUCTURE.md §3, because this module
 * owns a security boundary. `domain/` imports nothing framework-shaped, so the
 * password policy is unit-testable in milliseconds and cannot accidentally be
 * coupled to transport or persistence.
 *
 * No ports. PORTS-AND-CONTRACTS.md §3 enumerates the six contracts that exist
 * and `auth` holds none of them: "`auth` has no port — a token-store port is
 * not part of the approved architecture."
 *
 * NOTE WHAT IS **NOT** EXPORTED. `CredentialRepository` is provided here and
 * deliberately kept out of `exports`, which is what makes
 * AUTHORIZATION-MODEL.md §10 — "`passwordHash` never leaves AuthModule; no
 * other module imports the credential repository" — a structural guarantee
 * rather than a review convention. Nest will refuse to inject it elsewhere.
 *
 * Deferred, and why:
 *   forgot/reset-password — needs email delivery (NotificationsModule)
 *   OwnershipGuard        — no owned resource exists yet; it arrives with cart
 *                           and orders, which are the things to own
 *   cookie transport      — additive; Flutter needs only bearer tokens
 */
@Module({
  imports: [
    UsersModule,
    // Verification tokens are minted here and DELIVERED there. Auth owns the
    // token lifecycle; Notifications owns the template and the transport.
    NotificationsModule,
    // For TransactionService: refresh rotation revokes one document and inserts
    // another, and those two writes must not be separable.
    DatabaseModule,
    MongooseModule.forFeature([{ name: RefreshToken.name, schema: RefreshTokenSchema }]),
    JwtModule.registerAsync({
      inject: [authConfig.KEY],
      useFactory: (config: AuthConfig) => ({
        secret: config.jwtSecret,
        signOptions: { algorithm: 'HS256', expiresIn: config.accessTtlSeconds },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    PasswordService,
    EmailVerificationService,
    PasswordResetService,
    /*
     * No controller reaches this. It is provided so the two provisioning
     * scripts can resolve it from an application context, and it is NOT
     * exported — the same rule that keeps `CredentialRepository` inside this
     * module keeps the one service able to mint an ADMIN inside it too.
     */
    StaffProvisioningService,
    CredentialRepository,
    RefreshTokenRepository,
    JwtAuthGuard,
    RolesGuard,
  ],
  exports: [TokenService, JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
