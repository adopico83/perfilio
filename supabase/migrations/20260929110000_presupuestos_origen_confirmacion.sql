-- Distingue los presupuestos revisados por un humano (previsualizar_presupuesto +
-- confirmar_presupuesto) de los creados con el atajo crear_presupuesto (capitulos).

alter table public.presupuesto_previews
  add column if not exists origen text check (origen in ('previsualizacion', 'atajo'));

comment on column public.presupuesto_previews.origen is
  'Quién generó la preview: previsualizacion (previsualizar_presupuesto, revisable) o atajo (crear_presupuesto con capitulos, sin revisión). null = anterior a esta columna, se trata como no revisada.';

alter table public.presupuestos
  add column if not exists confirmado_por_humano boolean not null default false;

comment on column public.presupuestos.confirmado_por_humano is
  'true solo si el presupuesto salió de una preview guardada por previsualizar_presupuesto y confirmada con confirmar_presupuesto. Las filas anteriores a esta columna quedan en false: no hay forma de distinguir retroactivamente un atajo de uno revisado.';
