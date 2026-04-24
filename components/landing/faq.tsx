'use client';

import { useState } from 'react';

export default function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const faqs = [
    {
      question: '¿Que es tu agente?',
      answer:
        'Tu agente es el agente de Perfilio. Gestiona tus presupuestos, gastos, obras y operarios por voz. No es un chat, es un operador de negocio que ejecuta trabajo real.',
    },
    {
      question: '¿Necesito instalar algo?',
      answer:
        'Solo anadir Perfilio a la pantalla de inicio de tu movil. Funciona como una app sin pasar por ninguna tienda.',
    },
    {
      question: '¿Funciona con TicketBAI?',
      answer:
        'Perfilio genera tus facturas listas para TicketBAI. La integracion completa esta en el roadmap.',
    },
    {
      question: '¿Para que sectores es?',
      answer:
        'Para cualquier gremio o autonomo de construccion y reformas: albaniles, pintores, electricistas, fontaneros, decoradores.',
    },
    {
      question: '¿Cuanto cuesta?',
      answer:
        'Estamos en fase beta. Escribenos por WhatsApp y te explicamos las condiciones.',
    },
  ];

  return (
    <section className="py-20 bg-gray-400">
      <div className="container mx-auto px-4 max-w-4xl">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold text-gray-900 mb-4">
            Preguntas frecuentes
          </h2>
          <p className="text-xl text-gray-700">
            Todo lo que necesitas saber sobre Perfilio
          </p>
        </div>

        <div className="space-y-4">
          {faqs.map((faq, index) => (
            <div key={index} className="border border-gray-300 rounded-lg overflow-hidden">
              <button
                onClick={() => setOpenIndex(openIndex === index ? null : index)}
                className="w-full text-left p-6 bg-white hover:bg-gray-50 transition flex justify-between items-center"
              >
                <span className="font-semibold text-gray-900 pr-8">
                  {faq.question}
                </span>
                <span className="text-2xl text-[#ed8936] flex-shrink-0">
                  {openIndex === index ? '−' : '+'}
                </span>
              </button>

              {openIndex === index && (
                <div className="px-6 pb-6 text-gray-700 bg-gray-50">
                  {faq.answer}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
