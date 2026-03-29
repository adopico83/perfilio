import Link from 'next/link';

const VOLVER_CLASS =
  'inline-flex items-center gap-1 text-sm font-medium text-[#ed8936] border border-[#ed8936] rounded-lg px-4 py-2 bg-transparent hover:bg-[#ed8936]/10 transition-colors';

type VolverAlDashboardProps = {
  className?: string;
};

export default function VolverAlDashboard({ className }: VolverAlDashboardProps) {
  return (
    <Link
      href="/dashboard"
      className={[VOLVER_CLASS, className].filter(Boolean).join(' ')}
    >
      ← Volver al dashboard
    </Link>
  );
}
