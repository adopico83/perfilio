'use client';

import type { ReactNode } from 'react';
import AgentSidebar from './agent-sidebar';
import { useAgentSidebar } from '@/contexts/agent-sidebar-context';

export default function DashboardShell({ children }: { children: ReactNode }) {
  const { isOpen } = useAgentSidebar();

  return (
    <div className="min-h-screen bg-[#EFEADF] text-zinc-900">
      <div className="flex min-h-screen">
        <div className="flex-1 min-w-0">{children}</div>
        {isOpen && (
          <div className="hidden lg:block w-[25%] min-w-[320px] max-w-[420px]">
            <div className="sticky top-0 h-screen">
              <AgentSidebar />
            </div>
          </div>
        )}
        {isOpen && (
          <div className="lg:hidden">
            <AgentSidebar />
          </div>
        )}
      </div>
    </div>
  );
}

