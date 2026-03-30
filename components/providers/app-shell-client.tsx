'use client';

import type { ReactNode } from 'react';
import { CanvasProvider } from '@/contexts/canvas-context';
import { EmailModalProvider } from '@/contexts/email-modal-context';
import CanvasModal from '@/components/dashboard/canvas-modal';
import EmailModal from '@/components/dashboard/email-modal';
import UrgentesModal from '@/components/dashboard/urgentes-modal';

export default function AppShellClient({ children }: { children: ReactNode }) {
  return (
    <CanvasProvider>
      <EmailModalProvider>
        {children}
        <CanvasModal />
        <UrgentesModal />
        <EmailModal />
      </EmailModalProvider>
    </CanvasProvider>
  );
}
