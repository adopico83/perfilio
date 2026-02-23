'use client';

import { useState } from 'react';
import { Sparkles, Loader2 } from 'lucide-react';

export function DemoSection() {
  const [clientMessage, setClientMessage] = useState('');
  const [aiResponse, setAiResponse] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const ejemplosMensajes = [
    'Hola, necesito un presupuesto para instalar 3 ventanas de aluminio.',
    '¿Cuánto tiempo tardarían en hacer una reparación urgente?',
    'Buenos días, quisiera información sobre sus servicios de mantenimiento.',
  ];

  const handleGenerate = async () => {
    if (!clientMessage.trim()) return;

    setIsLoading(true);
    setAiResponse('');

    try {
      const response = await fetch('/api/assistant', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: `Cliente dice: "${clientMessage}". Genera una respuesta profesional y útil como si fueras el asistente de Perfilio.`,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setAiResponse(data.response);
      } else {
        setAiResponse('Error al generar respuesta. Por favor, inténtalo de nuevo.');
      }
    } catch (error) {
      setAiResponse('Error de conexión. Por favor, verifica tu conexión a internet.');
    } finally {
      setIsLoading(false);
    }
  };

  const usarEjemplo = (ejemplo: string) => {
    setClientMessage(ejemplo);
    setAiResponse('');
  };

  return (
    <section className="py-24 bg-gradient-to-b from-[#1a365d] to-[#0f2744] dark:from-gray-900 dark:to-gray-950">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-12">
          <div className="inline-flex items-center space-x-2 bg-[#ed8936]/10 border border-[#ed8936]/30 rounded-full px-4 py-2 mb-6">
            <Sparkles className="w-4 h-4 text-[#ed8936]" />
            <span className="text-sm font-semibold text-[#ed8936]">
              Demo Interactiva
            </span>
          </div>
          
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-6">
            Prueba el Asistente IA{' '}
            <span className="text-[#ed8936]">ahora mismo</span>
          </h2>
          <p className="text-lg text-gray-300">
            Escribe un mensaje de cliente y mira cómo Perfilio genera una respuesta profesional al instante
          </p>
        </div>

        {/* Demo Container */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-6xl mx-auto">
          {/* Izquierda: Input del cliente */}
          <div className="space-y-4">
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 border border-white/20">
              <label className="block text-white font-semibold mb-3 text-sm">
                📧 Mensaje del Cliente
              </label>
              <textarea
                value={clientMessage}
                onChange={(e) => setClientMessage(e.target.value)}
                placeholder="Escribe aquí el mensaje del cliente..."
                className="w-full h-40 px-4 py-3 bg-white dark:bg-gray-800 text-[#1a365d] dark:text-white border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-[#ed8936] focus:border-transparent resize-none placeholder:text-gray-400"
                disabled={isLoading}
              />

              {/* Botón Generar */}
              <button
                onClick={handleGenerate}
                disabled={isLoading || !clientMessage.trim()}
                className="w-full mt-4 inline-flex items-center justify-center px-6 py-3 bg-[#ed8936] hover:bg-[#dd6b20] text-white font-bold rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Generando respuesta...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5 mr-2" />
                    Generar Respuesta IA
                  </>
                )}
              </button>
            </div>

            {/* Ejemplos */}
            <div className="space-y-2">
              <p className="text-gray-300 text-sm font-medium">💡 Prueba con estos ejemplos:</p>
              <div className="space-y-2">
                {ejemplosMensajes.map((ejemplo, index) => (
                  <button
                    key={index}
                    onClick={() => usarEjemplo(ejemplo)}
                    className="w-full text-left px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-[#ed8936]/50 rounded-lg text-gray-300 text-sm transition-all"
                    disabled={isLoading}
                  >
                    {ejemplo}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Derecha: Respuesta IA */}
          <div className="space-y-4">
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 border border-white/20 min-h-[280px]">
              <label className="block text-white font-semibold mb-3 text-sm">
                🤖 Respuesta Generada por IA
              </label>
              
              {!aiResponse && !isLoading && (
                <div className="flex items-center justify-center h-40 text-gray-400 text-center">
                  <div>
                    <Sparkles className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>La respuesta aparecerá aquí...</p>
                  </div>
                </div>
              )}

              {isLoading && (
                <div className="flex items-center justify-center h-40">
                  <div className="text-center">
                    <Loader2 className="w-12 h-12 mx-auto mb-3 text-[#ed8936] animate-spin" />
                    <p className="text-gray-300">Generando respuesta profesional...</p>
                  </div>
                </div>
              )}

              {aiResponse && !isLoading && (
                <div className="bg-white dark:bg-gray-800 rounded-lg p-4 text-[#1a365d] dark:text-white whitespace-pre-wrap leading-relaxed">
                  {aiResponse}
                </div>
              )}
            </div>

            {/* Info */}
            <div className="bg-[#ed8936]/10 border border-[#ed8936]/30 rounded-lg p-4">
              <p className="text-gray-300 text-sm">
                ✨ <strong className="text-white">Esto es solo una demo.</strong> El asistente real de Perfilio aprende de tu negocio y se adapta a tu estilo de comunicación.
              </p>
            </div>
          </div>
        </div>

        {/* Bottom CTA */}
        <div className="mt-12 text-center">
          <p className="text-gray-300 mb-4">
            ¿Listo para tener tu propio asistente IA personalizado?
          </p>
          <a
            href="#probar"
            className="inline-flex items-center justify-center px-8 py-4 bg-white hover:bg-gray-100 text-[#1a365d] font-bold rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl"
          >
            Empezar prueba gratuita
          </a>
        </div>
      </div>
    </section>
  );
}
