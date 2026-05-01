'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@nest/ui';
import { ROUTES } from '@nest/config/constants';

export default function AccountError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="container mx-auto px-4 py-16 max-w-7xl">
      <div className="max-w-md mx-auto text-center border rounded-xl bg-card p-8">
        <AlertTriangle className="w-12 h-12 mx-auto text-destructive mb-4" />
        <h2 className="text-2xl font-bold mb-2">Account Error</h2>
        <p className="text-muted-foreground mb-6">
          {error.message || 'Something went wrong loading your account. Please try again.'}
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button onClick={reset}>Try Again</Button>
          <Button variant="outline" asChild>
            <Link href={ROUTES.home}>Back to Home</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
