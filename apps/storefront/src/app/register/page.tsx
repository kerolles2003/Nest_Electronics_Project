import { AuthShell } from '@/components/auth/AuthShell';
import { RegisterForm } from './form';

/**
 * Create an account.
 *
 * The redirect-away-when-signed-in check lives in `proxy.ts`, once, for every
 * page in the auth cluster — see `login/page.tsx` for why it is not here.
 */
export const dynamic = 'force-dynamic';

export default function RegisterPage() {
  return (
    <AuthShell
      title="Create your account"
      subtitle="One account for orders, addresses and delivery tracking"
    >
      <RegisterForm />
    </AuthShell>
  );
}
