'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowserClient } from '@nest/providers';
import { Eye, EyeOff, Mail, Lock, LogIn } from 'lucide-react';
import { loginSchema } from '@nest/types';
import { ROUTES } from '@nest/config/constants';
import Link from 'next/link';
import { useCartStore } from '@/stores/cart-store';
import { syncCartToDatabase } from '@/actions/cart.actions';


export function LoginForm({ redirectTo }: { redirectTo?: string }) {
  const router = useRouter();
  const cartItems = useCartStore((state) => state.items);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const result = loginSchema.safeParse({ email, password });
    if (!result.success) {
      setError(result.error.errors[0].message);
      return;
    }

    setLoading(true);

    const supabase = getSupabaseBrowserClient();

    const { data, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    if (data.user && cartItems.length > 0) {
      await syncCartToDatabase(
        cartItems.map((item) => ({
          productId: item.product_id,
          quantity: item.quantity,
          name: item.product.name_en,
          price: item.product.sale_price ?? item.product.base_price,
        }))
      );
    }

    router.push(redirectTo ?? ROUTES.account.orders);
    router.refresh();
  };

  const handleGoogleLogin = async () => {
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="rounded-xl bg-danger/5 border border-danger/10 p-4 text-sm text-danger animate-in fade-in slide-in-from-top-1 duration-300">
          <p className="font-semibold flex items-center gap-2">
            <Lock className="w-4 h-4" />
            {error}
          </p>
        </div>
      )}

      <div className="space-y-1.5">
        <label htmlFor="email" className="text-[13px] font-bold uppercase tracking-wider text-foreground-muted ml-1">
          Email Address
        </label>
        <div className="relative group">
          <div className="absolute left-4 top-1/2 -translate-y-1/2 text-foreground-muted group-focus-within:text-primary transition-colors">
            <Mail size={18} />
          </div>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full bg-surface border border-border rounded-xl px-11 py-3.5 text-foreground placeholder:text-foreground-disabled focus:border-primary focus:ring-4 focus:ring-primary/5 focus:outline-none transition-all text-[15px] font-medium"
            placeholder="name@company.com"
            required
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex justify-between items-center px-1">
          <label htmlFor="password" className="text-[13px] font-bold uppercase tracking-wider text-foreground-muted">
            Password
          </label>
          <Link href={ROUTES.forgotPassword} className="text-[12px] font-bold text-primary hover:underline">
            Forgot?
          </Link>
        </div>
        <div className="relative group">
          <div className="absolute left-4 top-1/2 -translate-y-1/2 text-foreground-muted group-focus-within:text-primary transition-colors">
            <Lock size={18} />
          </div>
          <input
            id="password"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-surface border border-border rounded-xl px-11 py-3.5 text-foreground placeholder:text-foreground-disabled focus:border-primary focus:ring-4 focus:ring-primary/5 focus:outline-none transition-all text-[15px] font-medium"
            placeholder="••••••••"
            required
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-foreground-muted hover:text-foreground transition-colors"
            tabIndex={-1}
          >
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-primary text-white py-4 rounded-xl font-bold uppercase tracking-widest text-[13px] hover:bg-primary-hover hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 transition-all shadow-lg shadow-primary/20 flex items-center justify-center gap-3"
      >
        {loading ? 'Authenticating...' : (
          <>
            Sign In
            <LogIn size={18} />
          </>
        )}
      </button>

      <div className="relative py-4">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center text-[12px] uppercase tracking-widest font-bold">
          <span className="bg-background px-4 text-foreground-muted">or continue with</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        <button
          type="button"
          onClick={handleGoogleLogin}
          className="flex items-center justify-center gap-3 border border-border rounded-xl py-3.5 text-[14px] font-bold hover:bg-surface transition-all active:scale-[0.98]"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.47 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Google
        </button>
      </div>

      <div className="pt-6 text-center">
        <p className="text-foreground-muted text-[15px] font-medium">
          New to Nest?{' '}
          <Link href={ROUTES.register} className="text-primary font-bold hover:underline">
            Create an account
          </Link>
        </p>
      </div>
    </form>
  );
}

