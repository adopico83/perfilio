import { type NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

export async function middleware(request: NextRequest) {
  const { supabaseResponse, user } = await updateSession(request);

  const { pathname } = request.nextUrl;

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
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     * - /api/lista-espera-notificacion (pública, landing sin sesión)
     * - (API routes protegidas si no hay usuario)
     */
    '/((?!api/lista-espera-notificacion|api/push/test-send|api/cron/agenda-push|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
