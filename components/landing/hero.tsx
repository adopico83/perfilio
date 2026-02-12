import Link from 'next/link';
import { Button } from '@/components/ui/button';

export function Hero() {
  return (
    <section className="relative overflow-hidden px-4 pt-28 pb-20 sm:px-6 sm:pt-36 sm:pb-28 lg:px-8">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_80%_60%_at_50%_-20%,var(--brand-blue-light),transparent)] dark:bg-[radial-gradient(ellipse_80%_60%_at_50%_-20%,var(--brand-blue),transparent)]" />
      <div className="mx-auto max-w-4xl text-center">
        <h1 className="text-4xl font-bold tracking-tight text-brand-blue dark:text-white sm:text-5xl lg:text-6xl">
          Gestiona tu negocio con un solo clic
        </h1>
        <p className="mt-6 text-lg text-brand-gray dark:text-brand-gray/90 sm:text-xl">
          Presupuestos automáticos, control de stock, facturas y comunicación por WhatsApp.
          Todo integrado con IA para que ahorres tiempo y vendas más.
        </p>
        <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Button asChild size="lg" variant="primary">
            <Link href="#cta">Probar gratis</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="#features">Ver funcionalidades</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
