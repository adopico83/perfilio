'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function DashboardPage() {
  const [conversations, setConversations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editedText, setEditedText] = useState('');

  // Cargar conversaciones
  const loadConversations = async () => {
    const { data, error } = await supabase
      .from('conversations')
      .select(`
        *,
        ai_responses (*)
      `)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (!error && data) {
      setConversations(data);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadConversations();
  }, []);

  // Generar respuesta IA
  const generateAIResponse = async (conversationId: string, message: string) => {
    try {
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });

      const data = await res.json();

      await supabase.from('ai_responses').insert({
        conversation_id: conversationId,
        ai_response: data.response,
      });

      loadConversations();
    } catch (error) {
      console.error('Error generando respuesta:', error);
    }
  };

  // Iniciar edición
  const startEditing = (responseId: string, currentText: string) => {
    setEditingId(responseId);
    setEditedText(currentText);
  };

  // Guardar edición
  const saveEdit = async (responseId: string) => {
    await supabase
      .from('ai_responses')
      .update({ edited_response: editedText })
      .eq('id', responseId);

    setEditingId(null);
    loadConversations();
  };

  // Cancelar edición
  const cancelEdit = () => {
    setEditingId(null);
    setEditedText('');
  };

  // Aprobar (usa versión editada si existe)
  const approveResponse = async (conversationId: string) => {
    await supabase
      .from('conversations')
      .update({ status: 'approved' })
      .eq('id', conversationId);

    // Marcar como aprobado
    await supabase
      .from('ai_responses')
      .update({ approved_at: new Date().toISOString() })
      .eq('conversation_id', conversationId);

    loadConversations();
  };

  // Rechazar
  const rejectResponse = async (conversationId: string) => {
    await supabase
      .from('conversations')
      .update({ status: 'rejected' })
      .eq('id', conversationId);

    loadConversations();
  };

  if (loading) {
    return <div className="p-8">Cargando...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
      <h1 className="text-3xl font-bold mb-8 text-gray-900">Dashboard - Mensajes Pendientes</h1>
        
        <div className="space-y-4">
          {conversations?.map((conv: any) => {
            const aiResponse = conv.ai_responses?.[0];
            const isEditing = editingId === aiResponse?.id;
            const displayText = aiResponse?.edited_response || aiResponse?.ai_response;

            return (
              <div key={conv.id} className="bg-white rounded-lg shadow p-6">
                {/* Header */}
                <div className="flex justify-between items-start mb-4">
                  <div>
                  <h3 className="font-bold text-lg text-gray-900">{conv.customer_name}</h3>
                    <p className="text-sm text-gray-600">{conv.customer_contact}</p>
                    <span className="inline-block mt-2 px-3 py-1 bg-blue-100 text-blue-800 text-xs rounded-full">
                      {conv.channel}
                    </span>
                  </div>
                  <span className="text-sm text-gray-500">
                    {new Date(conv.created_at).toLocaleDateString('es-ES')}
                  </span>
                </div>

                {/* Mensaje del cliente */}
                <div className="mb-4">
                  <p className="text-sm font-semibold text-gray-700 mb-2">Mensaje del cliente:</p>
                  <p className="text-gray-800 bg-gray-50 p-4 rounded">{conv.message}</p>
                </div>

                {/* Respuesta IA */}
                {aiResponse ? (
                  <div className="mb-4">
                    <p className="text-sm font-semibold text-gray-700 mb-2">
                      Respuesta sugerida por IA:
                      {aiResponse.edited_response && (
                        <span className="ml-2 text-xs text-blue-600">(editada)</span>
                      )}
                    </p>
                    
                    {isEditing ? (
                      <div>
                        <textarea
                          className="w-full p-4 border rounded text-gray-800"
                          rows={6}
                          value={editedText}
                          onChange={(e) => setEditedText(e.target.value)}
                        />
                        <div className="flex gap-2 mt-2">
                          <button
                            onClick={() => saveEdit(aiResponse.id)}
                            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
                          >
                            💾 Guardar
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-gray-800 bg-green-50 p-4 rounded border-l-4 border-green-500 whitespace-pre-wrap">
                        {displayText}
                      </p>
                    )}
                  </div>
                ) : (
                  <button
                    onClick={() => generateAIResponse(conv.id, conv.message)}
                    className="mb-4 px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700"
                  >
                    🤖 Generar Respuesta IA
                  </button>
                )}

                {/* Botones de acción */}
                {aiResponse && !isEditing && (
                  <div className="flex gap-3 mt-6">
                    <button
                      onClick={() => approveResponse(conv.id)}
                      className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
                    >
                      ✓ Aprobar y Enviar
                    </button>
                    <button
                      onClick={() => startEditing(aiResponse.id, displayText)}
                      className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                    >
                      ✎ Editar Respuesta
                    </button>
                    <button
                      onClick={() => rejectResponse(conv.id)}
                      className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
                    >
                      ✗ Rechazar
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}