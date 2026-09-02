import { AuthShell } from '@/components/auth/AuthShell';
import { ForgotPasswordForm } from './form';

export const dynamic = 'force-dynamic';

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter your email and we'll send you a link"
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
