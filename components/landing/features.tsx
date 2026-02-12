import {
  FileSpreadsheet,
  Package,
  Receipt,
  MessageCircle,
  ScanEye,
} from 'lucide-react';

const features = [
  {
    title: 'Presupuestos automáticos',
    description:
      'Genera presupuestos profesionales en segundos a partir de materiales y precios. Envíalos por email o WhatsApp y haz seguimiento del estado.',
    icon: FileSpreadsheet,
  },
  {
    title: 'Control de stock',
    description:
      'Lleva el inventario de materiales y productos. Alertas de stock bajo y actualización en tiempo real al generar presupuestos o facturas.',
    icon: Package,
  },
  {
    title: 'Facturas',
    description:
      'Emite facturas vinculadas a presupuestos o de forma independiente. Numeración automática y estados: pendiente, pagada, vencida.',
    icon: Receipt,
  },
  {
    title: 'WhatsApp',
    description:
      'Envía presupuestos y recordatorios por WhatsApp. Mantén la comunicación con tus clientes desde la misma plataforma.',
    icon: MessageCircle,
  },
  {
    title: 'IA Vision',
    description:
      'Sube fotos de obras o listados y deja que la IA sugiera materiales y cantidades. Acelera la creación de presupuestos con visión artificial.',
    icon: ScanEye,
  },
];

export function Features() {
  return (
    <section id="features" className="border-t border-brand-gray/20 bg-brand-gray/5 px-4 py-20 dark:border-brand-gray/10 dark:bg-brand-blue/10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="text-center">
          <h2 className="text-3xl font-bold tracking-tight text-brand-blue dark:text-white sm:text-4xl">
            Todo lo que necesitas en una sola herramienta
          </h2>
          <p className="mt-4 text-lg text-brand-gray dark:text-brand-gray/90">
            Diseñado para profesionales que quieren vender más y perder menos tiempo en papeleo.
          </p>
        </div>
        <div className="mt-16 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <article
                key={feature.title}
                className="rounded-2xl border border-brand-gray/20 bg-white p-6 shadow-sm transition-shadow hover:shadow-md dark:border-brand-gray/10 dark:bg-brand-blue/5"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-orange/15 text-brand-orange dark:bg-brand-orange/20">
                  <Icon className="h-6 w-6" aria-hidden />
                </div>
                <h3 className="mt-4 text-lg font-semibold text-brand-blue dark:text-white">
                  {feature.title}
                </h3>
                <p className="mt-2 text-brand-gray dark:text-brand-gray/90">
                  {feature.description}
                </p>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
