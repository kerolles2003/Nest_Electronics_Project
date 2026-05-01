import { createClient } from '@/lib/supabase';
import { NextResponse, type NextRequest } from 'next/server';
import { ROUTES } from '@nest/config/constants';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get('code');

  if (!code) {
    return NextResponse.redirect(
      new URL(`${ROUTES.login}?error=auth_callback_error`, request.url)
    );
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      throw error;
    }

    return NextResponse.redirect(new URL(ROUTES.account.orders, request.url));
  } catch {
    return NextResponse.redirect(
      new URL(`${ROUTES.login}?error=auth_callback_error`, request.url)
    );
  }
}
