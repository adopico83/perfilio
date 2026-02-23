'use client';

import { useState } from 'react';

export default function TestAssistant() {
  const [message, setMessage] = useState('');
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);

  const testAPI = async () => {
    setLoading(true);
    setResponse('');
    try {
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      const data = await res.json();
      console.log('Respuesta completa:', data);
      setResponse(data.response || data.error || 'No hay respuesta');
    } catch (error) {
      setResponse('Error al llamar a la API');
    }
    setLoading(false);
  };

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-4 text-white">Test Asistente IA</h1>
      
      <textarea
        className="w-full p-4 border rounded mb-4 text-black bg-white"
        rows={4}
        placeholder="Escribe un mensaje de cliente..."
        value={message}
        onChange={(e) => setMessage(e.target.value)}
      />
      
      <button
        onClick={testAPI}
        disabled={loading}
        className="bg-blue-600 text-white px-6 py-2 rounded"
      >
        {loading ? 'Generando...' : 'Generar Respuesta'}
      </button>
      
      {response && (
        <div className="mt-6 p-4 bg-gray-100 rounded text-black">
          <strong>Respuesta IA:</strong>
          <p className="mt-2 whitespace-pre-wrap">{response}</p>
        </div>
      )}
    </div>
  );
}