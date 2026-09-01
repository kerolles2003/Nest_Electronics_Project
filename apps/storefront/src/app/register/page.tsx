import { createClient } from '@/lib/supabase';
import { ROUTES } from '@nest/config/constants';
import { redirect } from 'next/navigation';
import { RegisterForm } from './form';
import { CheckCircle2, ShieldCheck, Truck, Zap } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';

export default async function RegisterPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    redirect(ROUTES.account.orders);
  }

  const trustPoints = [
    { icon: CheckCircle2, text: 'Genuine electronics & accessories', sub: 'Sourced from authorized distributors' },
    { icon: ShieldCheck, text: 'Secure checkout & protection', sub: 'Your data is encrypted and secure' },
    { icon: Truck, text: 'Fast delivery across Egypt', sub: 'Next-day delivery available in Cairo' },
  ];

  return (
    <div className="min-h-screen flex bg-background">
      {/* Visual Sidebar */}
      <div className="hidden lg:flex relative w-1/2 overflow-hidden bg-topbar">
        <Image
          src="/images/auth-bg.webp"
          alt="Auth Background"
          fill
          className="object-cover opacity-60 mix-blend-overlay"
          priority
        />
        <div className="absolute inset-0 bg-linear-to-b from-black/80 via-black/40 to-black/80" />
        <div className="absolute inset-0 hero-circuit opacity-20" />
        
        <div className="relative z-10 w-full flex flex-col justify-between p-16">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center shadow-lg shadow-primary/20">
              <Zap className="w-6 h-6 text-white fill-white" />
            </div>
            <span className="text-2xl font-black tracking-tighter text-white">NEST<span className="text-primary">.</span></span>
          </Link>

          <div className="max-w-md space-y-12">
            <div className="space-y-4">
              <h2 className="text-5xl font-black leading-tight text-white tracking-tight">
                Start your <span className="text-primary">Journey.</span>
              </h2>
              <p className="text-lg text-white/70 font-medium">
                Join thousands of engineers and makers. Create an account to track orders and save your favorite components.
              </p>
            </div>

            <div className="grid gap-8">
              {trustPoints.map((point) => (
                <div key={point.text} className="flex items-start gap-4 animate-rise">
                  <div className="mt-1 w-10 h-10 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-primary shrink-0 backdrop-blur-sm">
                    <point.icon className="w-5 h-5" />
                  </div>
                  <div className="space-y-1">
                    <h4 className="font-bold text-white text-[15px]">{point.text}</h4>
                    <p className="text-white/50 text-[13px] leading-relaxed">{point.sub}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="text-white/40 text-sm font-medium">
            © 2026 Nest Electronics. All rights reserved.
          </div>
        </div>
      </div>

      {/* Form Section */}
      <div className="flex-1 flex flex-col justify-center items-center p-8 md:p-12">
        <div className="w-full max-w-[400px] space-y-8 animate-rise">
          <div className="space-y-2 lg:hidden text-center mb-8">
             <Link href="/" className="inline-flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shadow-lg shadow-primary/20">
                  <Zap className="w-5 h-5 text-white fill-white" />
                </div>
                <span className="text-xl font-black tracking-tighter text-foreground">NEST<span className="text-primary">.</span></span>
            </Link>
          </div>

          <div className="space-y-1 text-center lg:text-left">
            <h1 className="text-3xl font-black tracking-tight text-foreground">Create Account</h1>
            <p className="text-foreground-muted font-medium">Join Nest Electronics community today</p>
          </div>
          
          <RegisterForm />
        </div>
      </div>
    </div>
  );
}

