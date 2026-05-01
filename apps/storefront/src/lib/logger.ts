// TODO: Install pino — run `pnpm --filter storefront add pino`
// Replace the console-based implementation with pino below:

/*
import pino from 'pino';

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  ...(process.env['NODE_ENV'] === 'production'
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true },
        },
      }),
});

export { logger };
*/

// Fallback structured logger using console (JSON output)
const LOG_LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
} as const;

type LogLevel = keyof typeof LOG_LEVELS;

const currentLevel: number = LOG_LEVELS[process.env['LOG_LEVEL'] as LogLevel] ?? LOG_LEVELS.info;

function log(level: LogLevel, message: string, data?: Record<string, unknown>) {
  const levelValue = LOG_LEVELS[level];
  if (levelValue < currentLevel) return;

  const entry = {
    level,
    timestamp: new Date().toISOString(),
    message,
    ...data,
  };

  const output = JSON.stringify(entry);

  switch (level) {
    case 'error':
      console.error(output);
      break;
    case 'warn':
      console.warn(output);
      break;
    case 'debug':
      console.debug(output);
      break;
    default:
      console.log(output);
  }
}

export const logger = {
  debug: (message: string, data?: Record<string, unknown>) => log('debug', message, data),
  info: (message: string, data?: Record<string, unknown>) => log('info', message, data),
  warn: (message: string, data?: Record<string, unknown>) => log('warn', message, data),
  error: (message: string, data?: Record<string, unknown>) => log('error', message, data),
};

export function logCheckoutFailure(params: {
  userId: string;
  reason: string;
  itemsCount: number;
  rpcError?: string;
}) {
  logger.warn('Checkout failed', {
    action: 'checkout',
    userId: params.userId,
    reason: params.reason,
    itemsCount: params.itemsCount,
    rpcError: params.rpcError,
  });
}

export function logStockConflict(params: {
  userId: string;
  productId: string;
  requested: number;
  available: number;
}) {
  logger.warn('Stock conflict detected', {
    action: 'checkout',
    userId: params.userId,
    productId: params.productId,
    requested: params.requested,
    available: params.available,
  });
}

export function logAuthFailure(params: {
  pathname: string;
  reason: string;
}) {
  logger.debug('Auth redirect triggered', {
    action: 'middleware',
    pathname: params.pathname,
    reason: params.reason,
  });
}

export function logCartSyncFailure(params: {
  userId: string;
  itemsCount: number;
  error: string;
}) {
  logger.error('Cart sync failed', {
    action: 'cart_sync',
    userId: params.userId,
    itemsCount: params.itemsCount,
    error: params.error,
  });
}

export function logInventoryError(params: {
  userId?: string;
  productId: string;
  error: string;
}) {
  logger.error('Inventory error', {
    action: 'inventory',
    userId: params.userId,
    productId: params.productId,
    error: params.error,
  });
}
