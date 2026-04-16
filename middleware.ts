import { type NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

export async function middleware(request: NextRequest) {
  const { supabaseResponse, user } = await updateSession(request);

  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/api/cron/')) {
    return supabaseResponse;
  }

  if (pathname.startsWith('/api/lista-espera-notificacion')) {
    return supabaseResponse;
  }

  // Si el usuario intenta acceder al dashboard sin estar autenticado
  if (pathname.startsWith('/dashboard') && !user) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return Response.redirect(url);
  }

  // Si el usuario intenta acceder a APIs sin estar autenticado
  if (pathname.startsWith('/api/') && !user) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  // Si el usuario está autenticado y intenta ir al login, redirigir al dashboard
  if (pathname === '/login' && user) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    return Response.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
