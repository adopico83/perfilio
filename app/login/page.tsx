'use client';

import { useState } from 'react';
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
      });

      if (error) {
        setError('Credenciales incorrectas. Por favor, verifica tu email y contraseña.');
        setLoading(false);
        return;
      }

      if (data.user) {
        router.push('/dashboard');
        router.refresh();
      }
    } catch (err) {
      setError('Error al iniciar sesión. Por favor, inténtalo de nuevo.');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1a365d] to-[#0f2744] flex items-center justify-center px-4">
      <div className="max-w-md w-full">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-4">
            <Image 
              src="/logo.png" 
              alt="Perfilio" 
              width={180}
              height={150}
              className="h-16 w-auto"
              priority
            />
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">
            Iniciar Sesión
          </h1>
          <p className="text-gray-300">
            Accede a tu panel de gestión empresarial
          </p>
        </div>

        {/* Formulario */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <form onSubmit={handleLogin} className="space-y-6">
            {/* Error */}
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-4 text-sm">
                {error}
              </div>
            )}

            {/* Email */}
            <div>
              <label htmlFor="email" className="block text-sm font-semibold text-[#1a365d] mb-2">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="tu@email.com"
                className="w-full px-4 py-3 bg-white text-gray-900 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#ed8936] focus:border-transparent transition-all"
                disabled={loading}
              />
            </div>

            {/* Contraseña */}
            <div>
              <label htmlFor="password" className="block text-sm font-semibold text-[#1a365d] mb-2">
                Contraseña
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="••••••••"
                className="w-full px-4 py-3 bg-white text-gray-900 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#ed8936] focus:border-transparent transition-all"
                disabled={loading}
              />
            </div>

            {/* Botón */}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#ed8936] hover:bg-[#dd6b20] text-white font-bold py-3 px-6 rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Iniciando sesión...' : 'Iniciar Sesión'}
            </button>
          </form>

          {/* Info adicional */}
          <div className="mt-6 pt-6 border-t border-gray-200 text-center">
            <p className="text-sm text-gray-600">
              ¿No tienes cuenta?{' '}
              <a href="/#probar" className="text-[#ed8936] hover:text-[#dd6b20] font-semibold">
                Prueba gratis
              </a>
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center">
          <a href="/" className="text-gray-300 hover:text-white text-sm transition-colors">
            ← Volver al inicio
          </a>
        </div>
      </div>
    </div>
  );
}
