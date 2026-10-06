-- Ya aplicada en producción el 6/10/2026 (01:11 Madrid). Fichero espejo: NO volver a ejecutar.
revoke all on function public.perfilio_user_in_business(text) from public;
revoke all on function public.perfilio_user_in_business(text) from anon;
grant execute on function public.perfilio_user_in_business(text) to authenticated, service_role;
