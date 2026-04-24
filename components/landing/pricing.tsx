interface PricingProps {
  onOpenListaEspera?: () => void;
}

const WHATSAPP_HREF =
  'https://wa.me/34697613884?text=Hola%2C%20he%20visto%20Perfilio%20en%20vuestra%20web%20y%20me%20gustar%C3%ADa%20ver%20c%C3%B3mo%20funciona';

export default function Pricing(_: PricingProps) {
    return (
      <section id="precios" className="py-20 bg-gray-50">
        <div className="container mx-auto px-4">
          <div className="text-center mb-10 max-w-3xl mx-auto">
            <h2 className="text-4xl font-bold text-gray-900 mb-4">
              Precios pensados para autonomos
            </h2>
            <p className="text-xl text-gray-600">
              Perfilio esta en fase beta. Los primeros gremios que entren tendran condiciones
              especiales. Escribenos y te lo contamos.
            </p>
          </div>
          <div className="text-center">
            <a
              href={WHATSAPP_HREF}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center px-10 py-5 bg-[#ed8936] hover:bg-[#dd6b20] text-white text-lg font-bold rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl"
            >
              Habla con nosotros
            </a>
          </div>
        </div>
      </section>
    );
  }