import Link from 'next/link';
import { Button } from '@/components/ui/button';

export function Cta() {
  return (
    <section id="cta" className="px-4 py-20 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl rounded-3xl bg-brand-blue px-8 py-16 text-center dark:bg-brand-blue/90">
        <h2 className="text-2xl font-bold text-white sm:text-3xl">
          ¿Listo para simplificar tu día a día?
        </h2>
        <p className="mt-4 text-brand-gray dark:text-white/80">
          Únete y empieza a generar presupuestos y facturas en minutos.
        </p>
        <div className="mt-8">
          <Button
            asChild
            size="lg"
            className="bg-white text-brand-blue hover:bg-white/90 dark:bg-brand-orange dark:text-white dark:hover:bg-brand-orange/90"
          >
            <Link href="#cta">Crear cuenta gratis</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
