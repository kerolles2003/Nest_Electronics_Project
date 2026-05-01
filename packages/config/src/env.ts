// Runtime env validation — throws at startup if required vars are missing.
// Import this in app entry points to catch misconfiguration early.

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

export const env = {
  supabase: {
    url: requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    anonKey: requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    serviceRoleKey: process.env['SUPABASE_SERVICE_ROLE_KEY'], // admin only
  },
  site: {
    url: process.env['NEXT_PUBLIC_SITE_URL'] ?? 'http://localhost:3000',
  },
} as const;
