import { Header } from '@/components/landing/header';
import { Hero } from '@/components/landing/hero';
import { Features } from '@/components/landing/features';
import { Sectors } from '@/components/landing/sectors';
import { Cta } from '@/components/landing/cta';
import { Footer } from '@/components/landing/footer';

export default function Home() {
  return (
    <div className="min-h-screen bg-white dark:bg-brand-blue/5">
      <Header />
      <main>
        <Hero />
        <Features />
        <Sectors />
        <Cta />
        <Footer />
      </main>
    </div>
  );
}
