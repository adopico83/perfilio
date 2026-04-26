import { createBrowserClient } from '@supabase/ssr';

let _client: ReturnType<typeof createBrowserClient> | undefined;

/**
 * Cliente de Supabase para el navegador (login, PWA, etc.).
 *
 * Nota sobre `auth.storage` / `localStorage`: `createBrowserClient` de `@supabase/ssr`
 * construye siempre un adaptador basado en cookies y lo asigna a `auth.storage` al
 * crear el cliente (sustituye cualquier `auth.storage` pasado en opciones). La
 * persistencia entre cierres del navegador depende de `cookieOptions` (p. ej. `maxAge`).
 *
 * Sobre `auth.storageKey`: si se fija una clave distinta a la del resto de instancias
 * (`createBrowserClient` en páginas del dashboard, etc.), las cookies no coincidirán y
 * la sesión no se verá en otras rutas. Mantener la clave por defecto del proyecto salvo
 * que se unifique en todos los puntos de creación del cliente.
 */
export function createClient() {
  if (_client) return _client;
  _client = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      isSingleton: true,
      auth: {
        persistSession: true,
      },
      cookieOptions: {
        maxAge: 400 * 24 * 60 * 60,
        path: '/',
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
      },
    }
  );
  return _client;
}
