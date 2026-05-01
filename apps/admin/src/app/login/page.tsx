import { LoginForm } from './form';
import { ShieldCheck } from 'lucide-react';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const isUnauthorized = params.error === 'unauthorized';

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center space-y-2">
          <div className="inline-flex p-3 rounded-2xl bg-primary/10 mb-2">
            <ShieldCheck className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-3xl font-black text-foreground tracking-tight uppercase font-heading">Admin Panel</h1>
          <p className="text-muted-foreground font-medium">Please sign in to manage your store</p>
        </div>

        <div className="bg-card border border-border rounded-2xl p-8 shadow-2xl">
          {isUnauthorized && (
            <div className="mb-6 p-4 rounded-xl bg-warning/10 border border-warning/20 text-warning text-sm font-medium text-center">
              Your account doesn&apos;t have administrative privileges.
            </div>
          )}
          <LoginForm />
        </div>

        <p className="text-center text-sm text-foreground-subtle font-medium italic">
          &copy; {new Date().getFullYear()} Nest Electronics - Secure Access Only
        </p>
      </div>
    </div>
  );
}
