'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import Image from 'next/image';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
        options: { shouldCreateUser: false },
      } as Parameters<typeof supabase.auth.signInWithPassword>[0]);

      if (error) {
        setError('Credenciales incorrectas. Por favor, verifica tu email y contraseña.');
        return;
      }

      if (data.user) {
        await supabase.auth.getSession();
        router.push('/dashboard');
        router.refresh();
      }
    } catch (err) {
      setError('Error al iniciar sesión. Por favor, inténtalo de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#EFEADF] flex items-center justify-center px-4">
      <div className="max-w-md w-full">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex flex-col items-center gap-2 mb-4 bg-zinc-900 rounded-2xl p-2">
            <Image 
              src="/logo.png" 
              alt="Perfilio" 
              width={120}
              height={100}
              className="w-32 h-auto"
              priority
            />
          </div>
          <h1 className="text-3xl font-bold text-zinc-900 mb-2">
            Iniciar Sesión
          </h1>
          <p className="text-zinc-600">
            Accede a tu panel de gestión empresarial
          </p>
        </div>

        {/* Formulario */}
        <div className="bg-[#E5DFD0] border border-zinc-400/40 rounded-2xl shadow-lg p-8">
          <form onSubmit={handleLogin} className="space-y-6">
            {/* Error */}
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-4 text-sm">
                {error}
              </div>
            )}

            {/* Email */}
            <div>
              <label htmlFor="email" className="block text-sm font-semibold text-zinc-800 mb-2">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="tu@email.com"
                className="w-full px-4 py-3 bg-[#EFEADF] text-zinc-900 border border-zinc-400/40 rounded-lg focus:ring-2 focus:ring-[#A04A2F] focus:border-[#A04A2F] transition-all"
                disabled={loading}
              />
            </div>

            {/* Contraseña */}
            <div>
              <label htmlFor="password" className="block text-sm font-semibold text-zinc-800 mb-2">
                Contraseña
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="••••••••"
                className="w-full px-4 py-3 bg-[#EFEADF] text-zinc-900 border border-zinc-400/40 rounded-lg focus:ring-2 focus:ring-[#A04A2F] focus:border-[#A04A2F] transition-all"
                disabled={loading}
              />
            </div>

            {/* Botón */}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#A04A2F] hover:bg-[#8a3f28] text-white font-bold py-3 px-6 rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Iniciando sesión...' : 'Iniciar Sesión'}
            </button>
          </form>

          {/* Info adicional */}
          <div className="mt-6 pt-6 border-t border-zinc-400/40 text-center">
            <p className="text-sm text-zinc-600">
              ¿No tienes cuenta?{' '}
              <Link href="/#probar" className="text-[#A04A2F] hover:text-[#8a3f28] font-semibold">
                Prueba gratis
              </Link>
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center">
          <Link href="/" className="text-zinc-600 hover:text-zinc-900 text-sm transition-colors">
            ← Volver al inicio
          </Link>
        </div>
      </div>
    </div>
  );
}
