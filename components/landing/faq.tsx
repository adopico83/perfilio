'use client';

import { useState } from 'react';

export default function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const faqs = [
    {
      question: '¿Cómo funciona el asistente IA?',
      answer: 'El asistente analiza automáticamente los emails y WhatsApps que recibes, genera respuestas profesionales adaptadas a tu negocio, y te las presenta en el dashboard para que las revises y apruebes antes de enviar.',
    },
    {
      question: '¿Necesito conocimientos técnicos?',
      answer: 'No. Perfilio está diseñado para ser simple. Solo necesitas conectar tu email/WhatsApp y el sistema empieza a funcionar. La interfaz es intuitiva y fácil de usar.',
    },
    {
      question: '¿Puedo cancelar cuando quiera?',
      answer: 'Sí, sin permanencia. Puedes cancelar tu suscripción en cualquier momento desde tu panel de control. No hay costes ocultos ni penalizaciones.',
    },
    {
      question: '¿Qué pasa si la IA genera una respuesta incorrecta?',
      answer: 'Todas las respuestas pasan por tu aprobación. Puedes editarlas, rechazarlas o aprobarlas. Tú tienes el control final antes de que se envíe cualquier mensaje.',
    },
    {
      question: '¿Funciona para mi sector?',
      answer: 'Perfilio funciona para cualquier pequeña empresa que reciba consultas de clientes. Tenemos módulos específicos para talleres, fontanería, electricistas, peluquerías y más.',
    },
    {
      question: '¿Incluye soporte técnico?',
      answer: 'Sí. Todos los planes incluyen soporte por email. El plan con módulos incluye soporte prioritario con respuesta en menos de 24h.',
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
