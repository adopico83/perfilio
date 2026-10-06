import { redirect } from 'next/navigation';

/** /ajustes no tenía pantalla propia (daba 404): lleva a la de ajustes del negocio. */
export default function AjustesPage() {
  redirect('/ajustes/marca');
}
