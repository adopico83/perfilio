export default function Stats() {
    const stats = [
      { number: '85%', label: 'Menos tiempo en emails' },
      { number: '10h', label: 'Ahorradas por semana' },
      { number: '2min', label: 'Tiempo de respuesta' },
      { number: '100%', label: 'Respuestas profesionales' },
    ];
  
    return (
      <section className="py-16 bg-gradient-to-b from-[#0f172a] to-[#1e293b]">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
              Resultados que hablan por sí solos
            </h2>
            <p className="text-xl text-gray-300">
              Empresas que usan Perfilio ahorran tiempo y mejoran su comunicación
            </p>
          </div>
  
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 max-w-5xl mx-auto">
            {stats.map((stat, index) => (
              <div key={index} className="text-center">
                <div className="text-5xl md:text-6xl font-bold text-[#ed8936] mb-2">
                  {stat.number}
                </div>
                <div className="text-gray-300 text-sm md:text-base">
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }