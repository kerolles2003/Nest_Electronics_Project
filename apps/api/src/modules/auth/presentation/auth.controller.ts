import { Body, Controller, Get, Header, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Types } from 'mongoose';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { ThrottleByEmail } from '../../../common/decorators/throttle-by-email.decorator';
import { ErrorResponseDto } from '../../../common/dto/error-response.dto';
import { AppException } from '../../../common/errors/app.exception';
import { UsersService } from '../../users/application/users.service';
import { AuthService } from '../application/auth.service';
import { EmailVerificationService } from '../application/email-verification.service';
import type { AuthenticatedUser } from '../domain/authenticated-user';
import { TokenService } from '../application/token.service';
import {
  LoginDto,
  RefreshTokenDto,
  RegisterDto,
  ResendVerificationDto,
  VerifyEmailDto,
} from './dto/auth-request.dto';
import {
  AuthUserDto,
  CurrentUserResponseDto,
  LoginResponseDto,
  MessageResponseDto,
  RefreshResponseDto,
  RegisterResponseDto,
  SessionTokensDto,
} from './dto/auth-response.dto';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Access tokens, refresh tokens and profiles are all things a shared cache must
 * never hold. Authority: docs/architecture/API-STANDARDS.md §7 — `no-store` on
 * every authenticated response and every auth endpoint.
 */
const NO_STORE = 'no-store';

/**
 * Authentication and identity.
 *
 * Authority: docs/architecture/API-CONTRACT.md §5.1; AUTHORIZATION-MODEL.md §2.
 *
 * Every response is `no-store`. An access token, a refresh token and a profile
 * are all things a shared cache must never hold (API-STANDARDS.md §7).
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
    private readonly verification: EmailVerificationService,
    private readonly users: UsersService,
  ) {}

  @Post('register')
  @Header('Cache-Control', NO_STORE)
  @Public()
  @Throttle({ global: { limit: 3, ttl: HOUR_MS } })
  @ApiOperation({
    summary: 'Create an account',
    description: [
      'Creates a `CUSTOMER` account and issues an email-verification challenge.',
      '',
      '**No session is returned.** The account must be verified before it can sign in, so the',
      'client should show a "check your email" state rather than navigating to a guarded route.',
      '',
      'The `role` field does not exist on this DTO. Sending one returns `400 UNKNOWN_FIELD`.',
      '',
      'Rate limited to 3 requests per hour per IP.',
    ].join('\n'),
  })
  @ApiCreatedResponse({ type: RegisterResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'VALIDATION_ERROR (including password policy) or UNKNOWN_FIELD.',
  })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'DUPLICATE_EMAIL' })
  @ApiTooManyRequestsResponse({ type: ErrorResponseDto, description: 'RATE_LIMIT_EXCEEDED' })
  async register(@Body() dto: RegisterDto): Promise<RegisterResponseDto> {
    await this.auth.register({
      email: dto.email,
      password: dto.password,
      fullName: dto.fullName,
      phone: dto.phone ?? null,
    });

    return {
      data: {
        message: 'Account created. Check your email to verify the address before signing in.',
        emailVerificationRequired: true,
      },
    };
  }

  @Post('login')
  @Header('Cache-Control', NO_STORE)
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ global: { limit: 5, ttl: 15 * 60 * 1000 } })
  @ThrottleByEmail()
  @ApiOperation({
    summary: 'Sign in',
    description: [
      'Returns an access/refresh token pair and the canonical user object.',
      '',
      '**An unknown email and a wrong password are indistinguishable** — same status, same code,',
      'same message, and the same wall-clock time. Do not build UI that tries to tell them apart.',
      '',
      '`EMAIL_NOT_VERIFIED` and `ACCOUNT_DISABLED` are reachable only AFTER a correct password,',
      'so they are safe to surface: they inform the account holder without informing an enumerator.',
      '',
      'Rate limited to 5 attempts per 15 minutes, per IP **and** email.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: LoginResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'VALIDATION_ERROR' })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'INVALID_CREDENTIALS' })
  @ApiForbiddenResponse({
    type: ErrorResponseDto,
    description: 'EMAIL_NOT_VERIFIED or ACCOUNT_DISABLED',
  })
  @ApiTooManyRequestsResponse({ type: ErrorResponseDto, description: 'RATE_LIMIT_EXCEEDED' })
  async login(@Body() dto: LoginDto): Promise<LoginResponseDto> {
    const { session, user } = await this.auth.login({ email: dto.email, password: dto.password });

    return {
      data: { ...SessionTokensDto.from(session), user: AuthUserDto.from(user) },
    };
  }

  @Post('refresh')
  @Header('Cache-Control', NO_STORE)
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ global: { limit: 60, ttl: HOUR_MS } })
  @ApiOperation({
    summary: 'Rotate the session',
    description: [
      'Exchanges a refresh token for a NEW access/refresh pair. The presented refresh token is',
      'invalidated by this call — refresh tokens are strictly single-use.',
      '',
      '**Client contract.** Store the new `refreshToken` before retrying the original request. If',
      'two requests refresh concurrently, one wins and the other receives',
      '`REFRESH_TOKEN_INVALID`; serialise refreshes behind a single in-flight future.',
      '',
      '**`REFRESH_TOKEN_REUSED` is terminal.** Presenting an already-rotated token is treated as',
      'theft: the entire rotation chain is revoked. Clear stored tokens and send the user to sign',
      'in — do not retry.',
      '',
      'Public because the access token is, by definition, already expired when this is called.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: RefreshResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'VALIDATION_ERROR' })
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description: 'REFRESH_TOKEN_INVALID or REFRESH_TOKEN_REUSED',
  })
  @ApiTooManyRequestsResponse({ type: ErrorResponseDto, description: 'RATE_LIMIT_EXCEEDED' })
  async refresh(@Body() dto: RefreshTokenDto): Promise<RefreshResponseDto> {
    return { data: SessionTokensDto.from(await this.tokens.rotate(dto.refreshToken)) };
  }

  @Post('logout')
  @Header('Cache-Control', NO_STORE)
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'End this session',
    description: [
      'Revokes the presented refresh token. **Idempotent**: an unknown or already-revoked token',
      'still returns 200, because the caller’s intent — "this session must not work" — is',
      'already satisfied.',
      '',
      'Public, and takes the refresh token in the body, so a client holding an expired access',
      'token can still sign out cleanly. The access token itself is not revocable; it expires on',
      'its own within 15 minutes.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: MessageResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'VALIDATION_ERROR' })
  async logout(@Body() dto: RefreshTokenDto): Promise<MessageResponseDto> {
    await this.auth.logout(dto.refreshToken);

    return { data: { message: 'Signed out.' } };
  }

  @Post('logout-all')
  @Header('Cache-Control', NO_STORE)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'End every session',
    description:
      'Revokes every live refresh token for the authenticated user, on every device. ' +
      'Outstanding access tokens remain valid for at most their 15-minute lifetime.',
  })
  @ApiOkResponse({ type: MessageResponseDto })
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description: 'UNAUTHENTICATED, TOKEN_EXPIRED or TOKEN_INVALID',
  })
  async logoutAll(@CurrentUser() principal: AuthenticatedUser): Promise<MessageResponseDto> {
    const revoked = await this.auth.logoutAll(new Types.ObjectId(principal.id));

    return { data: { message: `Signed out of ${String(revoked)} session(s).` } };
  }

  @Get('me')
  @Header('Cache-Control', NO_STORE)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'The authenticated user',
    description: [
      'Returns the canonical user object — the same shape embedded in the login response.',
      '',
      'Never returns `passwordHash`, `tokenVersion` or any verification state beyond the',
      '`emailVerified` boolean: those fields do not exist on this DTO.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: CurrentUserResponseDto })
  @ApiUnauthorizedResponse({
    type: ErrorResponseDto,
    description: 'UNAUTHENTICATED, TOKEN_EXPIRED or TOKEN_INVALID',
  })
  async me(@CurrentUser() principal: AuthenticatedUser): Promise<CurrentUserResponseDto> {
    const user = await this.users.findById(new Types.ObjectId(principal.id));

    // The token is valid but the account is gone or deactivated. 401, not 404:
    // the problem is the credential, and the client must re-authenticate.
    if (user === null) {
      throw AppException.unauthenticated();
    }

    return { data: AuthUserDto.from(user) };
  }

  @Post('verify-email')
  @Header('Cache-Control', NO_STORE)
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ global: { limit: 20, ttl: HOUR_MS } })
  @ApiOperation({
    summary: 'Verify an email address',
    description:
      'Consumes the single-use token from the verification email. Expired and unknown tokens are ' +
      'reported identically. Delivery of that email arrives with the notifications module.',
  })
  @ApiOkResponse({ type: MessageResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description: 'VALIDATION_ERROR — token invalid or expired.',
  })
  @ApiTooManyRequestsResponse({ type: ErrorResponseDto, description: 'RATE_LIMIT_EXCEEDED' })
  async verifyEmail(@Body() dto: VerifyEmailDto): Promise<MessageResponseDto> {
    await this.verification.verify(dto.token);

    return { data: { message: 'Email address verified. You can now sign in.' } };
  }

  @Post('resend-verification')
  @Header('Cache-Control', NO_STORE)
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ global: { limit: 3, ttl: HOUR_MS } })
  @ThrottleByEmail()
  @ApiOperation({
    summary: 'Resend the verification email',
    description: [
      '**Always returns 200**, whether or not the address exists or is already verified.',
      'Anything else would make this a password-free account-existence oracle.',
      '',
      'Issuing a new challenge invalidates the previous one.',
      '',
      'Rate limited to 3 requests per hour, per IP **and** email.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: MessageResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'VALIDATION_ERROR' })
  @ApiTooManyRequestsResponse({ type: ErrorResponseDto, description: 'RATE_LIMIT_EXCEEDED' })
  async resendVerification(@Body() dto: ResendVerificationDto): Promise<MessageResponseDto> {
    await this.verification.resend(dto.email);

    return {
      data: { message: 'If that address needs verification, a new email is on its way.' },
    };
  }
}
