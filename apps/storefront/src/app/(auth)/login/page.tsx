import { createClient } from '@/lib/supabase';
import { ROUTES } from '@nest/config/constants';
import { redirect } from 'next/navigation';
import { LoginForm } from './form';
import { CheckCircle, Shield, Truck } from 'lucide-react';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    redirect(ROUTES.account.orders);
  }

  const params = await searchParams;

  const trustPoints = [
    { icon: CheckCircle, text: 'Genuine electronics & accessories' },
    { icon: Shield, text: 'Secure checkout & buyer protection' },
    { icon: Truck, text: 'Fast delivery across Egypt' },
  ];

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-2">
      <div className="hidden lg:flex flex-col justify-center items-center bg-blue-600 p-12 text-white">
        <div className="max-w-md text-center space-y-8">
          <div>
            <h2 className="text-4xl font-extrabold tracking-tight">NEST</h2>
            <p className="text-blue-100 mt-1 text-lg">ELECTRONICS</p>
          </div>
          <div className="space-y-5">
            {trustPoints.map((point) => (
              <div key={point.text} className="flex items-center gap-3 text-left">
                <point.icon className="w-5 h-5 text-blue-200 flex-shrink-0" />
                <span className="text-blue-50">{point.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-col justify-center items-center p-8 bg-white">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-gray-900">Welcome back</h1>
            <p className="text-gray-500 mt-1">Sign in to your account</p>
          </div>
          <LoginForm redirectTo={params.redirect} />
        </div>
      </div>
    </div>
  );
}
