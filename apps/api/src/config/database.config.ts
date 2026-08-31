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
 * `dbName` and `poolSize` are deliberately absent: the database name travels
 * in the URI, and no evidence yet justifies overriding the driver's pool
 * defaults. Both are additive when a requirement appears.
 */
export const databaseConfig = registerAs('database', () => {
  const e = env();

  return { uri: e.MONGODB_URI } as const;
});

export type DatabaseConfig = ConfigType<typeof databaseConfig>;
