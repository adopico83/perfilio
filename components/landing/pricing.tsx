interface PricingProps {
  onOpenListaEspera?: () => void;
}

export default function Pricing({ onOpenListaEspera }: PricingProps) {
    return (
      <section className="py-20 bg-gray-50">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-gray-900 mb-4">
              Precios simples y transparentes
            </h2>
            <p className="text-xl text-gray-600">
              Sin sorpresas. Sin permanencia. Cancela cuando quieras.
            </p>
          </div>
  
          <div className="max-w-4xl mx-auto grid md:grid-cols-2 gap-8">
            {/* Plan Base */}
            <div className="bg-white rounded-2xl shadow-lg p-8 border-2 border-gray-200">
              <h3 className="text-2xl font-bold text-gray-900 mb-2">Plan Base</h3>
              <div className="mb-6">
                <span className="text-5xl font-bold text-[#1a365d]">99€</span>
                <span className="text-gray-600">/mes</span>
              </div>
              
              <ul className="space-y-4 mb-8">
                <li className="flex items-start">
                  <span className="text-green-500 mr-3">✓</span>
                  <span className="text-gray-700">Asistente IA ilimitado</span>
                </li>
                <li className="flex items-start">
                  <span className="text-green-500 mr-3">✓</span>
                  <span className="text-gray-700">Dashboard de gestión</span>
                </li>
                <li className="flex items-start">
                  <span className="text-green-500 mr-3">✓</span>
                  <span className="text-gray-700">Email y WhatsApp</span>
                </li>
                <li className="flex items-start">
                  <span className="text-green-500 mr-3">✓</span>
                  <span className="text-gray-700">Clasificación de urgencia</span>
                </li>
                <li className="flex items-start">
                  <span className="text-green-500 mr-3">✓</span>
                  <span className="text-gray-700">Soporte por email</span>
                </li>
              </ul>
  
              {onOpenListaEspera ? (
                <button
                  type="button"
                  onClick={onOpenListaEspera}
                  className="w-full bg-[#1a365d] text-white py-3 rounded-lg font-semibold hover:bg-[#2d4a7c] transition"
                >
                  Empezar ahora
                </button>
              ) : (
                <button className="w-full bg-[#1a365d] text-white py-3 rounded-lg font-semibold hover:bg-[#2d4a7c] transition">
                  Empezar ahora
                </button>
              )}
            </div>
  
            {/* Plan + Módulos */}
            <div className="bg-white rounded-2xl shadow-xl p-8 border-2 border-[#ed8936] relative">
              <div className="absolute -top-4 left-1/2 transform -translate-x-1/2 bg-[#ed8936] text-white px-4 py-1 rounded-full text-sm font-semibold">
                Recomendado
              </div>
              
              <h3 className="text-2xl font-bold text-gray-900 mb-2">Plan + Módulos</h3>
              <div className="mb-6">
                <span className="text-5xl font-bold text-[#ed8936]">149€</span>
                <span className="text-gray-600">/mes</span>
              </div>
              
              <ul className="space-y-4 mb-8">
                <li className="flex items-start">
                  <span className="text-green-500 mr-3">✓</span>
                  <span className="text-gray-700"><strong>Todo del Plan Base</strong></span>
                </li>
                <li className="flex items-start">
                  <span className="text-green-500 mr-3">✓</span>
                  <span className="text-gray-700">Módulo sector específico</span>
                </li>
                <li className="flex items-start">
                  <span className="text-green-500 mr-3">✓</span>
                  <span className="text-gray-700">Generación de presupuestos</span>
                </li>
                <li className="flex items-start">
                  <span className="text-green-500 mr-3">✓</span>
                  <span className="text-gray-700">Gestión de stock básica</span>
                </li>
                <li className="flex items-start">
                  <span className="text-green-500 mr-3">✓</span>
                  <span className="text-gray-700">Soporte prioritario</span>
                </li>
              </ul>
  
              {onOpenListaEspera ? (
                <button
                  type="button"
                  onClick={onOpenListaEspera}
                  className="w-full bg-[#ed8936] text-white py-3 rounded-lg font-semibold hover:bg-[#d77428] transition"
                >
                  Empezar ahora
                </button>
              ) : (
                <button className="w-full bg-[#ed8936] text-white py-3 rounded-lg font-semibold hover:bg-[#d77428] transition">
                  Empezar ahora
                </button>
              )}
            </div>
          </div>
  
          <p className="text-center text-gray-600 mt-12">
            🎉 <strong>Oferta de lanzamiento:</strong> Primeros 50 clientes obtienen 50% descuento los primeros 3 meses
          </p>
        </div>
      </section>
    );
  }