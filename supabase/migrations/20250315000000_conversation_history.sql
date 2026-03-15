-- Tabla de historial de conversación con el asistente IA por negocio y cliente
create table if not exists public.conversation_history (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  sender_email text not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_conversation_history_business_sender_created
  on public.conversation_history (business_id, sender_email, created_at desc);

comment on table public.conversation_history is 'Historial de mensajes usuario/asistente para memoria conversacional del asistente IA';
