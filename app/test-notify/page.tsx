'use client';

import { useState } from 'react';

const MENSAJE_URGENTE =
  '¡URGENTE! La ventana se ha roto y está entrando agua. Necesito que vengan ya, es una avería grave.';

export default function TestNotifyPage() {
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function enviarPrueba() {
    setLoading(true);
    setResponse(null);
    setError(null);
    try {
      const res = await fetch('/api/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: MENSAJE_URGENTE,
          senderName: 'Cliente prueba',
          channel: 'WhatsApp',
        }),
      });
      const data = await res.json();
      setResponse(JSON.stringify(data, null, 2));
      if (!res.ok) setError(res.statusText);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: 24, fontFamily: 'sans-serif' }}>
      <h1>Test notificación urgente</h1>
      <p>Mensaje de prueba: {MENSAJE_URGENTE}</p>
      <button
        type="button"
        onClick={enviarPrueba}
        disabled={loading}
        style={{ padding: '10px 20px', marginBottom: 16, fontSize: 16, cursor: loading ? 'wait' : 'pointer' }}
      >
        {loading ? 'Enviando...' : 'Enviar mensaje urgente de prueba'}
      </button>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {response && (
        <pre style={{ background: '#f5f5f5', padding: 16, overflow: 'auto' }}>
          {response}
        </pre>
      )}
    </div>
  );
}
