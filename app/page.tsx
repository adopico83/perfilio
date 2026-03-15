'use client';

import { useState } from 'react';
import { Header } from '@/components/landing/header';
import { Hero } from '@/components/landing/hero';
import { DemoSection } from '@/components/landing/demo-section';
import { Features } from '@/components/landing/features';
import { Sectors } from '@/components/landing/sectors';
import { Cta } from '@/components/landing/cta';
import { AgentesSection } from '@/components/landing/agentes-section';
import { Footer } from '@/components/landing/footer';
import { ListaEsperaModal } from '@/components/landing/lista-espera-modal';
import Stats from '@/components/landing/stats';
import Pricing from '@/components/landing/pricing';
import FAQ from '@/components/landing/faq';

export default function Home() {
  const [showListaEsperaModal, setShowListaEsperaModal] = useState(false);
  const openListaEspera = () => setShowListaEsperaModal(true);
  const closeListaEspera = () => setShowListaEsperaModal(false);

  return (
    <div className="min-h-screen bg-white dark:bg-brand-blue/5">
      <ListaEsperaModal open={showListaEsperaModal} onClose={closeListaEspera} />
      <Header onOpenListaEspera={openListaEspera} />
      <main>
        <Hero onOpenListaEspera={openListaEspera} />
        <Stats />  
        <DemoSection onOpenListaEspera={openListaEspera} />
        <Features />
        <Sectors />
        <AgentesSection onOpenListaEspera={openListaEspera} />
        <Pricing onOpenListaEspera={openListaEspera} />
        <FAQ />  
        <Cta onOpenListaEspera={openListaEspera} />
        <Footer />
        </main>
    </div>
  );
}
