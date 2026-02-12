/**
 * Tipos base del proyecto Perfilio.
 * Ampliar según DATABASE.md y necesidades del dominio.
 */

export interface Material {
  id: string;
  nombre: string;
  unidad: string;
  precio_unitario: number;
  stock_actual?: number;
  created_at: string;
  updated_at: string;
}

export interface Cliente {
  id: string;
  nombre: string;
  email?: string;
  telefono?: string;
  direccion?: string;
  created_at: string;
  updated_at: string;
}

export interface Presupuesto {
  id: string;
  cliente_id: string;
  estado: 'borrador' | 'enviado' | 'aceptado' | 'rechazado';
  total: number;
  valido_hasta?: string;
  created_at: string;
  updated_at: string;
}

export interface Factura {
  id: string;
  presupuesto_id?: string;
  cliente_id: string;
  numero: string;
  total: number;
  estado: 'pendiente' | 'pagada' | 'vencida';
  fecha_emision: string;
  created_at: string;
  updated_at: string;
}
