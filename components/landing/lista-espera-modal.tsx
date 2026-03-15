'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { X } from 'lucide-react';

type Status = 'idle' | 'loading' | 'success' | 'error';

interface ListaEsperaModalProps {
  open: boolean;
  onClose: () => void;
}

export function ListaEsperaModal({ open, onClose }: ListaEsperaModalProps) {
  const [nombre, setNombre] = useState('');
  const [apellido, setApellido] = useState('');
  const [telefono, setTelefono] = useState('');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const supabase = createClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('loading');
    setErrorMessage('');

    try {
      const { error } = await supabase.from('lista_espera').insert({
        nombre: nombre.trim(),
        apellido: apellido.trim(),
        telefono: telefono.trim(),
        email: email.trim(),
      });

      if (error) {
        setStatus('error');
        setErrorMessage(error.message || 'Error al guardar. Inténtalo de nuevo.');
        return;
      }

      setStatus('success');
      setNombre('');
      setApellido('');
      setTelefono('');
      setEmail('');

      // Notificación por email (secundaria, no bloquea al usuario)
      fetch('/api/lista-espera-notificacion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre: nombre.trim(),
          apellido: apellido.trim(),
          telefono: telefono.trim(),
          email: email.trim(),
        }),
      }).catch(() => {});
    } catch {
      setStatus('error');
      setErrorMessage('Error de conexión. Inténtalo de nuevo.');
    }
  };

  const handleClose = () => {
    onClose();
    setStatus('idle');
    setErrorMessage('');
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
        aria-hidden
      />
      <div
        className="relative w-full max-w-md bg-[#1a365d] rounded-2xl shadow-2xl border border-white/10 overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lista-espera-title"
      >
        <div className="flex justify-between items-center p-6 border-b border-white/10">
          <h2 id="lista-espera-title" className="text-xl font-bold text-white">
            Lista de espera
          </h2>
          <button
            type="button"
            onClick={handleClose}
            className="p-2 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Cerrar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {status === 'success' && (
            <div className="rounded-lg bg-green-500/20 border border-green-400/50 text-green-200 px-4 py-3 text-sm">
              ¡Apuntado! Te avisaremos cuando estés listo.
            </div>
          )}
          {status === 'error' && (
            <div className="rounded-lg bg-red-500/20 border border-red-400/50 text-red-200 px-4 py-3 text-sm">
              {errorMessage}
            </div>
          )}

          {status !== 'success' && (
            <>
              <div>
                <label htmlFor="lista-nombre" className="block text-sm font-medium text-white/90 mb-1">
                  Nombre
                </label>
                <input
                  id="lista-nombre"
                  type="text"
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  required
                  className="w-full px-4 py-2.5 bg-white/10 border border-white/20 rounded-lg text-white placeholder:text-white/50 focus:ring-2 focus:ring-[#ed8936] focus:border-[#ed8936] outline-none"
                  placeholder="Tu nombre"
                  disabled={status === 'loading'}
                />
              </div>
              <div>
                <label htmlFor="lista-apellido" className="block text-sm font-medium text-white/90 mb-1">
                  Apellido
                </label>
                <input
                  id="lista-apellido"
                  type="text"
                  value={apellido}
                  onChange={(e) => setApellido(e.target.value)}
                  required
                  className="w-full px-4 py-2.5 bg-white/10 border border-white/20 rounded-lg text-white placeholder:text-white/50 focus:ring-2 focus:ring-[#ed8936] focus:border-[#ed8936] outline-none"
                  placeholder="Tu apellido"
                  disabled={status === 'loading'}
                />
              </div>
              <div>
                <label htmlFor="lista-telefono" className="block text-sm font-medium text-white/90 mb-1">
                  Teléfono
                </label>
                <input
                  id="lista-telefono"
                  type="tel"
                  value={telefono}
                  onChange={(e) => setTelefono(e.target.value)}
                  required
                  className="w-full px-4 py-2.5 bg-white/10 border border-white/20 rounded-lg text-white placeholder:text-white/50 focus:ring-2 focus:ring-[#ed8936] focus:border-[#ed8936] outline-none"
                  placeholder="Tu teléfono"
                  disabled={status === 'loading'}
                />
              </div>
              <div>
                <label htmlFor="lista-email" className="block text-sm font-medium text-white/90 mb-1">
                  Email
                </label>
                <input
                  id="lista-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full px-4 py-2.5 bg-white/10 border border-white/20 rounded-lg text-white placeholder:text-white/50 focus:ring-2 focus:ring-[#ed8936] focus:border-[#ed8936] outline-none"
                  placeholder="tu@email.com"
                  disabled={status === 'loading'}
                />
              </div>
              <button
                type="submit"
                disabled={status === 'loading'}
                className="w-full py-3.5 bg-[#ed8936] hover:bg-[#dd6b20] text-white font-bold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {status === 'loading' ? 'Enviando...' : 'Apuntarme a la lista de espera'}
              </button>
            </>
          )}
          {status === 'success' && (
            <button
              type="button"
              onClick={handleClose}
              className="w-full py-3.5 bg-[#ed8936] hover:bg-[#dd6b20] text-white font-bold rounded-lg transition-colors"
            >
              Cerrar
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
