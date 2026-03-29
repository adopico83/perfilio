'use client';

import { useEffect, useMemo, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import VolverAlDashboard from '@/components/ui/volver-dashboard';
import LogoutButton from '../dashboard/logout-button';

export default function MensajesPage() {
  const supabase = useMemo(
    () =>
      createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      ),
    []
  );

  const [conversations, setConversations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editedText, setEditedText] = useState('');

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
      const priorityOrder = { urgent: 0, normal: 1, low: 2 };
      const sorted = data.sort((a, b) => {
        const aPriority = priorityOrder[a.priority as keyof typeof priorityOrder] ?? 1;
        const bPriority = priorityOrder[b.priority as keyof typeof priorityOrder] ?? 1;
        return aPriority - bPriority;
      });
      setConversations(sorted);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadConversations();
  }, []);

  const classifyMessage = async (message: string): Promise<string> => {
    try {
      const res = await fetch('/api/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      const data = await res.json();
      return data.priority || 'normal';
    } catch (error) {
      console.error('Error clasificando:', error);
      return 'normal';
    }
  };

  const generateAIResponse = async (conversationId: string, message: string) => {
    try {
      const conversation = conversations.find((c) => c.id === conversationId);
      if (!conversation.priority || conversation.priority === 'normal') {
        const priority = await classifyMessage(message);
        await supabase.from('conversations').update({ priority }).eq('id', conversationId);
      }

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

  const startEditing = (responseId: string, currentText: string) => {
    setEditingId(responseId);
    setEditedText(currentText);
  };

  const saveEdit = async (responseId: string) => {
    await supabase.from('ai_responses').update({ edited_response: editedText }).eq('id', responseId);

    setEditingId(null);
    loadConversations();
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditedText('');
  };

  const approveResponse = async (conversationId: string) => {
    await supabase.from('conversations').update({ status: 'approved' }).eq('id', conversationId);

    await supabase
      .from('ai_responses')
      .update({ approved_at: new Date().toISOString() })
      .eq('conversation_id', conversationId);

    loadConversations();
  };

  const rejectResponse = async (conversationId: string) => {
    await supabase.from('conversations').update({ status: 'rejected' }).eq('id', conversationId);

    await supabase
      .from('ai_responses')
      .update({ rejected_at: new Date().toISOString() })
      .eq('conversation_id', conversationId);

    loadConversations();
  };

  const getPriorityBadge = (priority: string) => {
    const badges = {
      urgent: { bg: 'bg-red-100', text: 'text-red-800', label: '🔴 Urgente' },
      normal: { bg: 'bg-yellow-100', text: 'text-yellow-800', label: '🟡 Normal' },
      low: { bg: 'bg-green-100', text: 'text-green-800', label: '🟢 Baja' },
    };
    const badge = badges[priority as keyof typeof badges] || badges.normal;
    return (
      <span className={`inline-block px-3 py-1 ${badge.bg} ${badge.text} text-xs rounded-full font-semibold`}>
        {badge.label}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0f172a] flex items-center justify-center">
        <p className="text-white">Cargando...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f172a] text-white p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <div className="flex justify-between items-center mb-4">
            <h1 className="text-2xl font-bold text-white">Bandeja de mensajes</h1>
            <div className="flex items-center gap-4">
              <VolverAlDashboard />
              <LogoutButton />
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {conversations?.map((conv: any) => {
            const aiResponse = conv.ai_responses?.[0];
            const isEditing = editingId === aiResponse?.id;
            const displayText = aiResponse?.edited_response || aiResponse?.ai_response;

            return (
              <div
                key={conv.id}
                className="bg-[#1a365d] border border-white/10 rounded-xl p-6 shadow-md"
              >
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="font-bold text-lg text-white">{conv.customer_name}</h3>
                    <p className="text-sm text-gray-300">{conv.customer_contact}</p>
                    <div className="flex gap-2 mt-2">
                      <span className="inline-block px-3 py-1 bg-blue-100 text-blue-800 text-xs rounded-full">
                        {conv.channel}
                      </span>
                      {getPriorityBadge(conv.priority)}
                    </div>
                  </div>
                  <span className="text-sm text-gray-300">
                    {new Date(conv.created_at).toLocaleDateString('es-ES')}
                  </span>
                </div>

                <div className="mb-4">
                  <p className="text-sm font-semibold text-gray-100 mb-2">Mensaje del cliente:</p>
                  <p className="text-[#e2e8f0] bg-[#111827] border border-white/10 p-4 rounded">
                    {conv.message}
                  </p>
                </div>

                {aiResponse ? (
                  <div className="mb-4">
                    <p className="text-sm font-semibold text-gray-100 mb-2">
                      Respuesta sugerida por IA:
                      {aiResponse.edited_response && (
                        <span className="ml-2 text-xs text-blue-300">(editada)</span>
                      )}
                    </p>

                    {isEditing ? (
                      <div>
                        <textarea
                          className="w-full p-4 border border-white/20 rounded bg-[#111827] text-[#e2e8f0]"
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
                      <p className="text-[#e2e8f0] bg-[#022c22] p-4 rounded border-l-4 border-green-500 whitespace-pre-wrap">
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

