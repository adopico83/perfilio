'use client';

import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { LogOut } from 'lucide-react';
import { useState } from 'react';

export default function LogoutButton() {
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
      className="inline-flex items-center gap-2 px-4 py-2 bg-[#ed8936] hover:bg-[#dd6b20] text-white font-semibold rounded-lg transition-all duration-200 shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <LogOut className="w-4 h-4" />
      {loading ? 'Cerrando...' : 'Cerrar Sesión'}
    </button>
  );
}
