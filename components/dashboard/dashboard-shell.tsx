'use client';

import type { ReactNode } from 'react';
import AgentSidebar from './agent-sidebar';
import DemoAppShell from './demo-app-shell';
import { useAgentSidebar } from '@/contexts/agent-sidebar-context';
import { useSession } from '@/components/providers/session-provider';
import { isDemoReformasTenant } from '@/lib/demo-tenant';

export default function DashboardShell({ children }: { children: ReactNode }) {
  const { isOpen } = useAgentSidebar();
  const { user, businessName } = useSession();
  const isDemo = isDemoReformasTenant({
    businessName,
    email: user?.email,
  });

  if (isDemo) {
    return <DemoAppShell businessName={businessName}>{children}</DemoAppShell>;
  }

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
