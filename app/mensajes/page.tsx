'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import VolverAlDashboard from '@/components/ui/volver-dashboard';
import LogoutButton from '../dashboard/logout-button';

interface AiResponse {
  id: string;
  ai_response?: string | null;
  edited_response?: string | null;
}

interface Conversation {
  id: string;
  customer_name?: string | null;
  customer_contact?: string | null;
  channel?: string | null;
  priority?: string | null;
  created_at: string;
  message?: string | null;
  ai_responses?: AiResponse[] | null;
}

export default function MensajesPage() {
  const supabase = useMemo(
    () =>
      createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      ),
    []
  );

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editedText, setEditedText] = useState('');

  const loadConversations = useCallback(async () => {
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
      const sorted = (data as Conversation[]).sort((a, b) => {
        const aPriority = priorityOrder[a.priority as keyof typeof priorityOrder] ?? 1;
        const bPriority = priorityOrder[b.priority as keyof typeof priorityOrder] ?? 1;
        return aPriority - bPriority;
      });
      setConversations(sorted);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    queueMicrotask(() => void loadConversations());
  }, [loadConversations]);

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
      if (!conversation?.priority || conversation.priority === 'normal') {
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
      <div className="min-h-screen bg-[#EFEADF] flex items-center justify-center">
        <p className="text-zinc-900">Cargando...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#EFEADF] text-zinc-900 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <div className="flex justify-between items-center mb-4">
            <h1 className="text-2xl font-bold text-zinc-900">Bandeja de mensajes</h1>
            <div className="flex items-center gap-4">
              <VolverAlDashboard />
              <LogoutButton />
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {conversations?.map((conv) => {
            const aiResponse = conv.ai_responses?.[0];
            const isEditing = editingId === aiResponse?.id;
            const displayText = aiResponse?.edited_response || aiResponse?.ai_response;

            return (
              <div
                key={conv.id}
                className="bg-[#E5DFD0] border border-zinc-400/40 rounded-xl p-6 shadow-md"
              >
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="font-bold text-lg text-zinc-900">{conv.customer_name}</h3>
                    <p className="text-sm text-zinc-600">{conv.customer_contact}</p>
                    <div className="flex gap-2 mt-2">
                      <span className="inline-block px-3 py-1 bg-[#A04A2F]/15 text-[#A04A2F] text-xs rounded-full">
                        {conv.channel}
                      </span>
                      {getPriorityBadge(conv.priority ?? 'normal')}
                    </div>
                  </div>
                  <span className="text-sm text-zinc-600">
                    {new Date(conv.created_at).toLocaleDateString('es-ES')}
                  </span>
                </div>

                <div className="mb-4">
                  <p className="text-sm font-semibold text-zinc-800 mb-2">Mensaje del cliente:</p>
                  <p className="text-zinc-800 bg-[#E5DFD0] border border-zinc-400/40 p-4 rounded">
                    {conv.message}
                  </p>
                </div>

                {aiResponse ? (
                  <div className="mb-4">
                    <p className="text-sm font-semibold text-zinc-800 mb-2">
                      Respuesta sugerida por IA:
                      {aiResponse.edited_response && (
                        <span className="ml-2 text-xs text-[#A04A2F]">(editada)</span>
                      )}
                    </p>

                    {isEditing ? (
                      <div>
                        <textarea
                          className="w-full p-4 border border-zinc-400/50 rounded bg-[#E5DFD0] text-zinc-800"
                          rows={6}
                          value={editedText}
                          onChange={(e) => setEditedText(e.target.value)}
                        />
                        <div className="flex gap-2 mt-2">
                          <button
                            onClick={() => saveEdit(aiResponse.id)}
                            className="px-4 py-2 bg-[#5a7a4a] text-white rounded hover:bg-[#4d6b40]"
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
                      <p className="text-zinc-800 bg-[#5a7a4a]/10 p-4 rounded border-l-4 border-[#5a7a4a] whitespace-pre-wrap">
                        {displayText}
                      </p>
                    )}
                  </div>
                ) : (
                  <button
                    onClick={() => generateAIResponse(conv.id, conv.message ?? '')}
                    className="mb-4 px-4 py-2 bg-[#A04A2F] text-white rounded hover:bg-[#8a3f28]"
                  >
                    🤖 Generar Respuesta IA
                  </button>
                )}

                {aiResponse && !isEditing && (
                  <div className="flex gap-3 mt-6">
                    <button
                      onClick={() => approveResponse(conv.id)}
                      className="px-4 py-2 bg-[#5a7a4a] text-white rounded hover:bg-[#4d6b40]"
                    >
                      ✓ Aprobar y Enviar
                    </button>
                    <button
                      onClick={() => startEditing(aiResponse.id, displayText ?? '')}
                      className="px-4 py-2 bg-[#A04A2F] text-white rounded hover:bg-[#8a3f28]"
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

