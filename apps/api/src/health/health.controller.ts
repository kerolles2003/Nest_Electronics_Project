import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Connection } from 'mongoose';
import { Public } from '../common/decorators/public.decorator';
import { INDEX_SYNC_REMEDY, IndexHealthService } from '../database/index-health.service';
import {
  HealthResponseDto,
  ReadinessResponseDto,
  type DependencyCheckDto,
  type IndexCheckDto,
} from './health.response.dto';

/** Long enough for a healthy round trip, short enough not to stall a probe. */
const PING_TIMEOUT_MS = 2_000;

/**
 * What the index check reports when the database never answered.
 *
 * `down`, not `up` — readiness has already failed on Mongo, and reporting the
 * indexes as fine would assert something nothing verified. The detail says
 * UNKNOWN rather than naming indexes, because sending someone to run
 * `indexes:sync` against an unreachable database wastes the one minute they
 * have to find the real fault.
 */
const SKIPPED_INDEX_CHECK = {
  status: 'down',
  detail: 'not checked - the database did not answer',
  missing: [],
  unexpected: [],
  remedy: null,
} as const satisfies IndexCheckDto;

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
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly indexHealth: IndexHealthService,
  ) {}

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
      'Checks that MongoDB answers, and that every index the schemas declare actually exists.',
      '',
      'The index check is not decoration. `autoIndex` is off by design, so a database that has',
      'never had `indexes:sync` run against it connects, answers every query, and serves traffic',
      'with several unique constraints simply absent - and those constraints are the entire',
      'enforcement behind "one account per email" and "one order per idempotency key". An',
      'instance in that state must refuse traffic rather than accept it and violate them.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: ReadinessResponseDto })
  @ApiResponse({ status: 503, type: ReadinessResponseDto, description: 'A dependency is down.' })
  async ready(@Res({ passthrough: true }) response: Response): Promise<ReadinessResponseDto> {
    const mongo = await this.pingMongo();

    // Sequential, not parallel, and deliberately so: with no database there is
    // no catalogue to read, and a second wave of failing commands would only
    // add noise to the logs of an outage that already has a cause.
    const indexes = mongo.status === 'up' ? await this.checkIndexes() : { ...SKIPPED_INDEX_CHECK };

    const healthy = mongo.status === 'up' && indexes.status === 'up';

    // 503, not 200-with-a-flag: infrastructure routes on the STATUS CODE, and
    // a body saying "degraded" under a 200 keeps traffic arriving at an
    // instance that cannot serve it.
    response.status(healthy ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);

    return { status: healthy ? 'ok' : 'degraded', checks: { mongo, indexes } };
  }

  /**
   * Names every missing index and the one command that creates them.
   *
   * `detail` is a sentence rather than a code because this response is what
   * somebody reads at the moment a deployment refuses to come up, and the whole
   * point of the check is that the underlying state gives no other clue.
   */
  private async checkIndexes(): Promise<IndexCheckDto> {
    const report = await this.indexHealth.verify();
    const missing = report.missing.map((index) => `${index.collection}.${index.name}`);
    const unexpected = report.unexpected.map((index) => `${index.collection}.${index.name}`);

    if (missing.length === 0) {
      return { status: 'up', detail: null, missing: [], unexpected, remedy: null };
    }

    return {
      status: 'down',
      detail:
        `${String(missing.length)} of ${String(report.declared)} declared indexes are missing ` +
        `or have the wrong options. Run: ${INDEX_SYNC_REMEDY}`,
      missing,
      unexpected,
      remedy: INDEX_SYNC_REMEDY,
    };
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

    /*
     * The timer is CLEARED in `finally`, and that is not tidiness.
     *
     * `Promise.race` settles on the winner but does not cancel the loser, so a
     * timer left behind here outlives every successful probe by two seconds. It
     * holds the event loop open, which means a process asked to shut down waits
     * for a timeout belonging to a check that already passed — and jest reports
     * the same thing as "did not exit one second after the test run", which is
     * how this was found.
     */
    let timer: NodeJS.Timeout | undefined;

    try {
      await Promise.race([
        db.admin().ping(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('ping timed out')), PING_TIMEOUT_MS);
        }),
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
    } finally {
      clearTimeout(timer);
    }
  }
}
