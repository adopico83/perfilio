'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import Link from 'next/link';
import LogoutButton from './logout-button';

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
      // Ordenar por prioridad: urgent > normal > low
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

  // Clasificar mensaje
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

  // Generar respuesta IA
  const generateAIResponse = async (conversationId: string, message: string) => {
    try {
      // Primero clasificar si no tiene prioridad
      const conversation = conversations.find(c => c.id === conversationId);
      if (!conversation.priority || conversation.priority === 'normal') {
        const priority = await classifyMessage(message);
        await supabase
          .from('conversations')
          .update({ priority })
          .eq('id', conversationId);
      }

      // Luego generar respuesta
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

  // Aprobar
  const approveResponse = async (conversationId: string) => {
    await supabase
      .from('conversations')
      .update({ status: 'approved' })
      .eq('id', conversationId);

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

    await supabase
      .from('ai_responses')
      .update({ rejected_at: new Date().toISOString() })
      .eq('conversation_id', conversationId);

    loadConversations();
  };

  // Función para obtener badge de prioridad
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
    return <div className="p-8">Cargando...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
      <div className="mb-8">
  <div className="flex justify-between items-center mb-4">
    <a href="/dashboard">
      <div style={{ display: 'inline-flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 16px)', gridTemplateRows: 'repeat(2, 16px)', gap: '2px', flexShrink: 0 }}>
            <div style={{ background: '#888' }}></div>
            <div style={{ background: '#1a6ec7' }}></div>
            <div style={{ background: '#888' }}></div>
            <div style={{ background: '#1a6ec7' }}></div>
            <div style={{ background: '#888' }}></div>
            <div style={{ background: '#1a6ec7' }}></div>
          </div>
          <span style={{ color: '#1a6ec7', fontWeight: 'bold', fontSize: '34px', lineHeight: '34px', letterSpacing: '0px', padding: '0', margin: '0' }}>PINO</span>
        </div>
        <span style={{ color: '#888', fontSize: '9.5px', letterSpacing: '8.2px', marginTop: '1px' }}>ALBAÑILERÍA</span>
      </div>
    </a>
    <div className="flex items-center gap-4">
      <Link href="/historial" className="text-sm text-gray-600 hover:text-[#1a365d] transition-colors">
        Historial
      </Link>
      <Link
        href="/agente"
        className="inline-flex items-center px-4 py-2 text-sm font-medium text-[#ed8936] bg-transparent border border-[#ed8936] rounded-lg hover:bg-[#ed8936] hover:text-white transition-colors"
      >
        ✨ Agente IA
      </Link>
      <LogoutButton />
    </div>
  </div>
  
  {/* Contador de mensajes */}
  <div className="flex gap-4 items-center bg-white p-4 rounded-lg shadow">
    <div className="flex items-center gap-2">
      <span className="text-2xl font-bold text-gray-900">
        {conversations.length}
      </span>
      <span className="text-gray-600">mensajes pendientes</span>
    </div>
    
    <div className="h-8 w-px bg-gray-300"></div>
    
    <div className="flex gap-4">
      <div className="flex items-center gap-2">
        <span className="text-red-600 font-semibold">
          🔴 {conversations.filter(c => c.priority === 'urgent').length}
        </span>
        <span className="text-sm text-gray-600">urgentes</span>
      </div>
      
      <div className="flex items-center gap-2">
        <span className="text-yellow-600 font-semibold">
          🟡 {conversations.filter(c => c.priority === 'normal').length}
        </span>
        <span className="text-sm text-gray-600">normales</span>
      </div>
      
      <div className="flex items-center gap-2">
        <span className="text-green-600 font-semibold">
          🟢 {conversations.filter(c => c.priority === 'low').length}
        </span>
        <span className="text-sm text-gray-600">baja prioridad</span>
      </div>
    </div>
  </div>
</div>
        
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
                    <div className="flex gap-2 mt-2">
                      <span className="inline-block px-3 py-1 bg-blue-100 text-blue-800 text-xs rounded-full">
                        {conv.channel}
                      </span>
                      {getPriorityBadge(conv.priority)}
                    </div>
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