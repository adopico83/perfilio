'use client';

import { useState } from 'react';

export default function TestClassify() {
  const [message, setMessage] = useState('');
  const [result, setResult] = useState('');

  const testClassify = async () => {
    const res = await fetch('/api/classify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    const data = await res.json();
    setResult(JSON.stringify(data, null, 2));
  };

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-4 text-gray-900">Test Clasificación</h1>
      
      <textarea
        className="w-full p-4 border rounded mb-4"
        rows={4}
        placeholder="Escribe un mensaje para clasificar..."
        value={message}
        onChange={(e) => setMessage(e.target.value)}
      />
      
      <button
        onClick={testClassify}
        className="bg-blue-600 text-white px-6 py-2 rounded mb-4"
      >
        Clasificar
      </button>
      
      {result && (
        <pre className="bg-gray-100 p-4 rounded text-sm text-black">{result}</pre>
      )}
    </div>
  );
}