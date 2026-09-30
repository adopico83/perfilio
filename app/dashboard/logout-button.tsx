'use client';

import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { LogOut } from 'lucide-react';
import { useState } from 'react';

/** `compact`: en móvil solo icono (36-40 px) y el texto desde sm; sin él, el botón de siempre. */
export default function LogoutButton({ compact = false }: { compact?: boolean }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  const handleLogout = async () => {
    setLoading(true);
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  return (
    <button
      onClick={handleLogout}
      disabled={loading}
      aria-label={compact ? 'Cerrar sesión' : undefined}
      title={compact ? 'Cerrar sesión' : undefined}
      className={
        compact
          ? 'inline-flex size-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap bg-[#A04A2F] hover:bg-[#8a3f28] text-white text-sm font-semibold rounded-lg transition-all duration-200 shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed sm:size-auto sm:px-3 sm:py-2'
          : 'inline-flex items-center gap-2 px-4 py-2 bg-[#A04A2F] hover:bg-[#8a3f28] text-white font-semibold rounded-lg transition-all duration-200 shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed'
      }
    >
      <LogOut className="w-4 h-4 shrink-0" />
      <span className={compact ? 'hidden sm:inline' : undefined}>
        {loading ? 'Cerrando...' : 'Cerrar Sesión'}
      </span>
    </button>
  );
}
