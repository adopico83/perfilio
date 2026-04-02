'use client';

import type { ReactNode } from 'react';
import { CanvasProvider } from '@/contexts/canvas-context';
import { EmailModalProvider } from '@/contexts/email-modal-context';
import { ObraModalProvider } from '@/contexts/obra-modal-context';
import CanvasModal from '@/components/dashboard/canvas-modal';
import EmailModal from '@/components/dashboard/email-modal';
import UrgentesModal from '@/components/dashboard/urgentes-modal';
import ObraModal from '@/components/dashboard/obra-modal';

export default function AppShellClient({ children }: { children: ReactNode }) {
  return (
    <CanvasProvider>
      <EmailModalProvider>
        <ObraModalProvider>
          {children}
          <CanvasModal />
          <UrgentesModal />
          <EmailModal />
          <ObraModal />
        </ObraModalProvider>
      </EmailModalProvider>
    </CanvasProvider>
  );
}
