'use client';

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-white to-gray-50 dark:from-gray-900 dark:to-gray-800 pt-16 pb-24 sm:pt-24 sm:pb-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:gap-8 items-center">
          {/* Contenido izquierdo */}
          <div className="space-y-8">
            {/* Badge */}
            <div className="inline-flex items-center space-x-2 bg-[#ed8936]/10 border border-[#ed8936]/20 rounded-full px-4 py-2">
              <span className="inline-flex h-2 w-2 rounded-full bg-[#ed8936] animate-pulse"></span>
              <span className="text-sm font-semibold text-[#ed8936]">
                Nuevo: Asistente IA integrado
              </span>
            </div>

            {/* Headline */}
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-[#1a365d] dark:text-white leading-tight">
              Tu negocio en{' '}
              <span className="text-[#ed8936]">piloto automático</span>
            </h1>

            {/* Subheadline */}
            <p className="text-lg sm:text-xl text-[#4a5568] dark:text-gray-300 leading-relaxed">
              Perfilio gestiona tus <strong>emails, WhatsApps y llamadas con IA</strong> mientras tú te enfocas en lo que importa
            </p>

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row gap-4">
              <a
                href="#como-funciona"
                className="inline-flex items-center justify-center px-8 py-4 text-[#1a365d] dark:text-white font-bold border-2 border-[#1a365d] dark:border-white rounded-lg hover:bg-[#1a365d] hover:text-white dark:hover:bg-white dark:hover:text-[#1a365d] transition-all duration-200"
              >
                Ver cómo funciona
              </a>
              <a
                href="#probar"
                className="inline-flex items-center justify-center px-8 py-4 bg-[#ed8936] hover:bg-[#dd6b20] text-white font-bold rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl"
              >
                Probar 14 días gratis
              </a>
            </div>

            {/* Trust indicators */}
            <div className="flex flex-wrap items-center gap-6 pt-4 text-sm text-[#4a5568] dark:text-gray-400">
              <div className="flex items-center space-x-2">
                <svg className="h-5 w-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
                <span className="font-medium">Sin tarjeta de crédito</span>
              </div>
              <div className="flex items-center space-x-2">
                <svg className="h-5 w-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
                <span className="font-medium">Cancela cuando quieras</span>
              </div>
            </div>
          </div>

          {/* Mockup del asistente IA - Lado derecho */}
          <div className="relative">
            {/* Glow effect */}
            <div className="absolute inset-0 bg-[#ed8936]/20 blur-3xl rounded-full"></div>
            
            {/* Mockup container */}
            <div className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden transform hover:scale-105 transition-transform duration-300">
              {/* Header del asistente */}
              <div className="bg-gradient-to-r from-[#1a365d] to-[#2d4a7c] p-5 border-b border-gray-700">
                <div className="flex items-center space-x-3">
                  <div className="text-3xl">🤖</div>
                  <div className="flex-1">
                    <h3 className="text-white font-bold text-lg">Asistente Perfilio</h3>
                    <div className="flex items-center space-x-2 mt-1">
                      <span className="inline-flex h-2 w-2 rounded-full bg-green-400 animate-pulse"></span>
                      <span className="inline-flex h-2 w-2 rounded-full bg-green-400 animate-pulse delay-75"></span>
                      <span className="inline-flex h-2 w-2 rounded-full bg-green-400 animate-pulse delay-150"></span>
                      <span className="text-green-400 text-sm font-medium ml-1">En línea</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Contenido del asistente */}
              <div className="p-4 space-y-4 bg-gray-50 dark:bg-gray-900">
                {/* Alerta urgente */}
                <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border-l-4 border-red-500 shadow-md hover:shadow-lg transition-shadow">
                  <div className="flex items-start space-x-3">
                    <div className="flex-shrink-0">
                      <span className="inline-flex items-center px-2.5 py-1 rounded text-xs font-bold bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
                        🔴 URGENTE
                      </span>
                    </div>
                  </div>
                  <div className="mt-3">
                    <p className="font-bold text-[#1a365d] dark:text-white text-base">
                      📞 Pedro llamó 3 veces
                    </p>
                    <p className="text-[#4a5568] dark:text-gray-400 text-sm mt-1">
                      "Presupuesto ventanas urgente"
                    </p>
                  </div>
                  <div className="flex space-x-2 mt-3">
                    <button className="flex-1 bg-[#ed8936] hover:bg-[#dd6b20] text-white text-sm font-bold py-2 px-3 rounded-lg transition-colors">
                      Llamar ahora
                    </button>
                    <button className="flex-1 border border-[#1a365d] dark:border-gray-600 text-[#1a365d] dark:text-white text-sm font-medium py-2 px-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                      Ver detalle
                    </button>
                  </div>
                </div>

                {/* Emails */}
                <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-md hover:shadow-lg transition-shadow border border-gray-200 dark:border-gray-700">
                  <div className="space-y-2">
                    <p className="font-bold text-[#1a365d] dark:text-white">
                      📧 5 emails nuevos
                    </p>
                    <div className="flex items-center space-x-2 text-sm">
                      <span className="text-green-600 dark:text-green-400 font-medium">
                        ✅ 3 respondidos automáticamente
                      </span>
                    </div>
                    <div className="flex items-center space-x-2 text-sm">
                      <span className="text-yellow-600 dark:text-yellow-400 font-medium">
                        ⚠️ 2 necesitan tu revisión
                      </span>
                    </div>
                  </div>
                  <button className="w-full mt-3 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-[#1a365d] dark:text-white text-sm font-medium py-2 px-3 rounded-lg transition-colors">
                    Ver borradores
                  </button>
                </div>

                {/* WhatsApp */}
                <div className="bg-gradient-to-br from-green-50 to-emerald-50 dark:from-gray-800 dark:to-gray-800 rounded-lg p-4 shadow-md hover:shadow-lg transition-shadow border border-green-200 dark:border-green-900/30">
                  <div className="space-y-2">
                    <p className="font-bold text-[#1a365d] dark:text-white">
                      💬 WhatsApp - Cliente García
                    </p>
                    <p className="text-[#4a5568] dark:text-gray-400 text-sm italic">
                      "¿Para cuándo la instalación?"
                    </p>
                    <div className="flex items-center space-x-2 mt-2">
                      <span className="text-green-600 dark:text-green-400 text-sm font-medium">
                        Borrador listo ✓
                      </span>
                    </div>
                  </div>
                  <div className="flex space-x-2 mt-3">
                    <button className="flex-1 bg-green-600 hover:bg-green-700 text-white text-sm font-bold py-2 px-3 rounded-lg transition-colors">
                      Enviar
                    </button>
                    <button className="flex-1 border border-green-600 dark:border-green-700 text-green-700 dark:text-green-400 text-sm font-medium py-2 px-3 rounded-lg hover:bg-green-50 dark:hover:bg-gray-700 transition-colors">
                      Editar
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
