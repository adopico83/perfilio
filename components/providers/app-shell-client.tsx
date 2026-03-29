'use client';

import type { ReactNode } from 'react';
import { CanvasProvider } from '@/contexts/canvas-context';
import CanvasModal from '@/components/dashboard/canvas-modal';

export default function AppShellClient({ children }: { children: ReactNode }) {
  return (
    <CanvasProvider>
      {children}
      <CanvasModal />
    </CanvasProvider>
  );
}
