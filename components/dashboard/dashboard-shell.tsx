import type { ReactNode } from 'react';
import AgentSidebar from './agent-sidebar';

export default function DashboardShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0f172a] text-white">
      <div className="flex min-h-screen">
        <div className="flex-1 min-w-0">{children}</div>
        <div className="hidden lg:block w-[25%] min-w-[320px] max-w-[420px]">
          <div className="sticky top-0 h-screen">
            <AgentSidebar />
          </div>
        </div>
        <div className="lg:hidden">
          <AgentSidebar />
        </div>
      </div>
    </div>
  );
}

