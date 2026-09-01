import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Connection } from 'mongoose';
import { Public } from '../common/decorators/public.decorator';
import {
  HealthResponseDto,
  ReadinessResponseDto,
  type DependencyCheckDto,
} from './health.response.dto';

/** Long enough for a healthy round trip, short enough not to stall a probe. */
const PING_TIMEOUT_MS = 2_000;

/**
 * The two probes an orchestrator needs, and no more.
 *
 * Authority: docs/architecture/API-STANDARDS.md §10;
 *            docs/architecture/NESTJS-MODULE-MAP.md §4.15.
 *
 * ## Why two endpoints and not one
 *
 * They answer different questions and have opposite failure responses.
 *
 *   LIVENESS   "is this process wedged?"        A failure means RESTART ME.
 *   READINESS  "can it serve traffic right now?" A failure means STOP SENDING
 *                                                traffic; do not restart.
 *
 * Conflating them is a classic outage amplifier: if liveness checked MongoDB,
 * a database blip would make every instance fail its liveness probe at once
 * and the orchestrator would restart the entire fleet — turning a recoverable
 * dependency wobble into a cold-start stampede against an already struggling
 * database. Liveness therefore depends on NOTHING, and must stay that way.
 */
@ApiTags('health')
@Controller('health')
@Public()
export class HealthController {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  @Get()
  @ApiOperation({
    summary: 'Liveness probe',
    description:
      'Returns 200 while the HTTP runtime is accepting requests. Requires no authentication and ' +
      'checks no dependency — a failure here means the process should be restarted.',
  })
  @ApiOkResponse({ type: HealthResponseDto })
  check(): HealthResponseDto {
    return { status: 'ok' };
  }

  @Get('ready')
  @ApiOperation({
    summary: 'Readiness probe',
    description: [
      'Reports whether critical dependencies are reachable. `200` when every check passes,',
      '`503` when any is down — so a load balancer can drain this instance without restarting it.',
      '',
      'Currently checks MongoDB only. Cloudinary appears here when MediaModule does; reporting a',
      'dependency that does not exist as `up` would be a lie a load balancer believes.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: ReadinessResponseDto })
  @ApiResponse({ status: 503, type: ReadinessResponseDto, description: 'A dependency is down.' })
  async ready(@Res({ passthrough: true }) response: Response): Promise<ReadinessResponseDto> {
    const mongo = await this.pingMongo();
    const healthy = mongo.status === 'up';

    // 503, not 200-with-a-flag: infrastructure routes on the STATUS CODE, and
    // a body saying "degraded" under a 200 keeps traffic arriving at an
    // instance that cannot serve it.
    response.status(healthy ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);

    return { status: healthy ? 'ok' : 'degraded', checks: { mongo } };
  }

  /**
   * An actual command round trip, not `readyState`.
   *
   * `readyState === 1` only says the driver believes it is connected; it stays
   * 1 through a network partition until a heartbeat finally fails. `ping` puts
   * a real request on the wire, which is the only thing that distinguishes "the
   * connection object exists" from "the database answers".
   *
   * Bounded by an explicit timeout so a hung database cannot hold the probe
   * open past the orchestrator's own deadline — an unanswered probe is
   * indistinguishable from a crashed process and gets treated as one.
   */
  private async pingMongo(): Promise<DependencyCheckDto> {
    const db = this.connection.db;

    if (db === undefined) {
      return { status: 'down', detail: 'no database handle' };
    }

    try {
      await Promise.race([
        db.admin().ping(),
        new Promise<never>((_resolve, reject) =>
          setTimeout(() => reject(new Error('ping timed out')), PING_TIMEOUT_MS),
        ),
      ]);

      return { status: 'up', detail: null };
    } catch (error) {
      // The MESSAGE only. A driver error can carry the host list, the replica
      // set name and occasionally the URI — and this endpoint is unauthenticated
      // (OBSERVABILITY.md §4: never leak connection details to a caller).
      return {
        status: 'down',
        detail: error instanceof Error ? error.message.slice(0, 120) : 'unreachable',
      };
    }
  }
}
