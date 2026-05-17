'use client';

import { Header } from '@/components/landing/header';
import Hero from '@/components/landing/hero';
import { DemoSection } from '@/components/landing/demo-section';
import { Features } from '@/components/landing/features';
import { Sectors } from '@/components/landing/sectors';
import { Cta } from '@/components/landing/cta';
import { Footer } from '@/components/landing/footer';
import Pricing from '@/components/landing/pricing';
import FAQ from '@/components/landing/faq';

export default function Home() {
  return (
    <div data-theme="light" className="min-h-screen bg-background">
      <Header />
      <main>
        <Hero />
        <DemoSection />
        <Features />
        <Sectors />
        <Pricing />
        <FAQ />
        <Cta />
        <Footer />
      </main>
    </div>
  );
}
