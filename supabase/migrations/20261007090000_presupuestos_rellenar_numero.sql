-- ⚠️ MIGRACIÓN NO ADITIVA: actualiza datos (rellena numero_presupuesto NULL). Revisar antes de aplicar.
--
-- Los presupuestos creados por el agente (crear_presupuesto, registrar_extra) se guardaban sin
-- número. A partir de este cambio el código ya los numera; esta migración rellena los antiguos.
--
-- Qué hace: para cada negocio, a los presupuestos con numero_presupuesto NULL les da
-- números correlativos a continuación del máximo que ya exista en ese negocio, en orden de
-- created_at (y de id si empatan). NO toca los que ya tienen número.
--
-- Efecto esperado: los presupuestos antiguos sin número pasan a tener un número MÁS ALTO que los
-- presupuestos más recientes que sí lo tenían. Es correcto (el número es solo un identificador
-- único por negocio) pero conviene saberlo antes de aplicarla.
--
-- Es idempotente: una segunda ejecución no encuentra NULLs y no cambia nada. Respeta el índice
-- único (business_id, numero_presupuesto) porque parte del máximo de cada negocio.

with maximos as (
  select business_id, coalesce(max(numero_presupuesto), 0) as maximo
  from public.presupuestos
  where business_id is not null
  group by business_id
),
pendientes as (
  select
    p.id,
    row_number() over (partition by p.business_id order by p.created_at, p.id) as orden,
    p.business_id
  from public.presupuestos p
  where p.numero_presupuesto is null
    and p.business_id is not null
)
update public.presupuestos p
set numero_presupuesto = m.maximo + pe.orden
from pendientes pe
join maximos m on m.business_id = pe.business_id
where p.id = pe.id;

-- Comprobación posterior (solo lectura; debería devolver 0 filas):
-- select id, business_id, created_at from public.presupuestos
-- where numero_presupuesto is null and business_id is not null;
