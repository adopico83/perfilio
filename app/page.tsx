import { Header } from '@/components/landing/header';
import { Hero } from '@/components/landing/hero';
import { DemoSection } from '@/components/landing/demo-section';
import { Features } from '@/components/landing/features';
import { Sectors } from '@/components/landing/sectors';
import { Cta } from '@/components/landing/cta';
import { AgentesSection } from '@/components/landing/agentes-section';
import { Footer } from '@/components/landing/footer';
import Stats from '@/components/landing/stats';
import Pricing from '@/components/landing/pricing';
import FAQ from '@/components/landing/faq';

export default function Home() {
  return (
    <div className="min-h-screen bg-white dark:bg-brand-blue/5">
      <Header />
      <main>
        <Hero />
        <Stats />  
        <DemoSection />
        <Features />
        <Sectors />
        <AgentesSection />
        <Pricing />
        <FAQ />  
        <Cta />
        <Footer />
        </main>
    </div>
  );
}
