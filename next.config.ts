import type { NextConfig } from 'next';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Directorio de este repo (donde está next.config.ts). */
const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  /**
   * Con varios package-lock.json (p. ej. uno en un directorio padre), Next 16 + Turbopack
   * puede inferir una raíz incorrecta y en `next dev` las rutas App Router /api/* devuelven 404
   * aunque los archivos existan. Forzar la raíz del proyecto evita eso sin cambiar producción.
   */
  turbopack: {
    root: projectRoot,
  },
};

export default nextConfig;
