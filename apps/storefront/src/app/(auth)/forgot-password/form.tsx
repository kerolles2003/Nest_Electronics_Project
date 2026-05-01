'use client';

import { useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { ROUTES } from '@nest/config/constants';
import Link from 'next/link';
import { Mail } from 'lucide-react';

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess(false);

    if (!email || !email.includes('@')) {
      setError('Please enter a valid email address');
      return;
    }

    setLoading(true);

    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/account/profile`,
    });

    if (resetError) {
      setError(resetError.message);
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);
  };

  if (success) {
    return (
      <div className="space-y-4">
        <div className="flex flex-col items-center gap-3 rounded-md bg-green-50 border border-green-200 p-6 text-center">
          <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
            <Mail size={24} className="text-green-600" />
          </div>
          <p className="text-sm text-green-600">
            Check your email for a password reset link.
          </p>
        </div>
        <p className="text-center text-sm text-gray-500">
          <Link href={ROUTES.login} className="text-blue-600 hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-600">
          {error}
        </div>
      )}

      <div className="space-y-1.5">
        <label htmlFor="email" className="text-sm font-medium text-gray-700">
          Email
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
          placeholder="you@example.com"
          required
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-blue-600 text-white py-2.5 rounded-md font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
      >
        {loading ? 'Sending...' : 'Send Reset Link'}
      </button>

      <p className="pt-2 text-center text-sm text-gray-500">
        Remember your password?{' '}
        <Link href={ROUTES.login} className="text-blue-600 hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
