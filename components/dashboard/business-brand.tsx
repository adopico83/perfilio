import Link from 'next/link';

/** Marca del negocio en la barra superior. Pino conserva el logo actual. */
export default function BusinessBrand({ name }: { name: string | null }) {
  if (name === 'Pino Albañilería') {
    return (
      <Link
        href="/dashboard"
        className="inline-flex min-w-0 shrink-0"
        aria-label="Pino Albañilería, ir al dashboard"
      >
        <span style={{ display: 'inline-flex', flexDirection: 'column' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 16px)',
                gridTemplateRows: 'repeat(2, 16px)',
                gap: '2px',
                flexShrink: 0,
              }}
              aria-hidden
            >
              <span style={{ background: '#888' }} />
              <span style={{ background: '#1a6ec7' }} />
              <span style={{ background: '#888' }} />
              <span style={{ background: '#1a6ec7' }} />
              <span style={{ background: '#888' }} />
              <span style={{ background: '#1a6ec7' }} />
            </span>
            <span
              style={{
                color: '#1a6ec7',
                fontWeight: 'bold',
                fontSize: '34px',
                lineHeight: '34px',
                letterSpacing: '0px',
              }}
            >
              PINO
            </span>
          </span>
          <span
            style={{
              color: '#888',
              fontSize: '9.5px',
              letterSpacing: '8.2px',
              marginTop: '1px',
            }}
          >
            ALBAÑILERÍA
          </span>
        </span>
      </Link>
    );
  }

  const label = name?.trim() || 'Perfilio';
  return (
    <Link
      href="/dashboard"
      className="min-w-0 truncate text-xl font-bold text-zinc-900 sm:text-2xl"
    >
      {label}
    </Link>
  );
}
