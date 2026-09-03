import { registerAs } from '@nestjs/config';
import type { ConfigType } from '@nestjs/config';
import { env } from './env.schema';

/**
 * Database connection configuration.
 *
 * The URI arrives already validated and typed: DatabaseModule never parses an
 * environment variable, checks for an empty string, applies a default, or
 * inspects NODE_ENV. Those responsibilities stay in the configuration
 * boundary.
 *
 * Authority: docs/architecture/CONFIGURATION-ARCHITECTURE.md §2, §4.
 *
 * `poolSize` is deliberately absent: no evidence yet justifies overriding the
 * driver's pool defaults, and it is additive when a requirement appears.
 *
 * ## `MONGODB_DB_NAME` is resolved HERE, into the URI
 *
 * The override exists so each test suite can be handed a database of its own
 * (`src/database/testing/scratch-databases.ts`). It is applied by rewriting the
 * URI rather than by passing a second option to Mongoose, and that is the whole
 * design decision:
 *
 * A separate `dbName` option only reaches consumers that know to ask for it.
 * `test/infrastructure/transaction-gate.spec.ts` opens an INDEPENDENT verifier
 * connection from `databaseConfig.uri` — deliberately, because proving a
 * transaction committed requires a connection that was never in it. With two
 * mechanisms the writer went to the scratch database and the verifier to the
 * development one, and the gate failed with `Expected: 1, Received: 0`. It was
 * right to. One resolved string cannot split like that: whatever connects with
 * this URI is on the same database as everything else.
 */

/**
 * The database segment of a MongoDB connection string, or `undefined` when it
 * names none.
 *
 * Parsed with a regular expression rather than `new URL`, because a connection
 * string may carry several comma-separated hosts (`mongodb://a:1,b:2/db`) and
 * the WHATWG parser has no useful reading of that authority.
 */
const CONNECTION_STRING = /^(mongodb(?:\+srv)?:\/\/[^/?#]*)(?:\/([^?#]*))?([?#].*)?$/;

export function databaseIn(uri: string): string | undefined {
  const path = CONNECTION_STRING.exec(uri)?.[2];

  return path === undefined || path.length === 0 ? undefined : path;
}

/**
 * The same connection string, naming a different database.
 *
 * Everything else is preserved verbatim — credentials, every host, and the
 * option string — because those are the parts that are hard to reproduce and
 * easy to corrupt.
 */
export function withDatabase(uri: string, database: string | undefined): string {
  if (database === undefined) return uri;

  const match = CONNECTION_STRING.exec(uri);

  if (match === null) {
    // Unreachable through the configuration boundary: `envSchema` has already
    // refused anything that is not a connection string. Stated rather than
    // assumed, because this function returns a string either way and a silent
    // passthrough would connect to the wrong database.
    throw new Error('MONGODB_URI is not a connection string, so it cannot be redirected');
  }

  return `${match[1] ?? ''}/${database}${match[3] ?? ''}`;
}

export const databaseConfig = registerAs('database', () => {
  const e = env();
  const uri = withDatabase(e.MONGODB_URI, e.MONGODB_DB_NAME);

  return {
    uri,
    /**
     * The database that URI names. Derived from it, not held alongside it, so
     * the two cannot disagree.
     *
     * Unlike the URI this is safe to log: it carries no host and no credential.
     */
    database: databaseIn(uri),
  } as const;
});

export type DatabaseConfig = ConfigType<typeof databaseConfig>;
