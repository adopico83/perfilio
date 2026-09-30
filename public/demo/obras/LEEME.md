# Fotos del diario de obra (demo)

El mock del tenant demo (`lib/demo-data/orbegozo-operativa.ts`) apunta a estas 5 rutas.
Hay que subir los archivos **con exactamente estos nombres** a esta carpeta:

| Archivo | Obra | Entrada del diario |
| --- | --- | --- |
| `algorta-antes-cocina.jpg` | Reforma integral piso Algorta | La más antigua («estado inicial») |
| `algorta-durante-instalaciones.jpg` | Reforma integral piso Algorta | Intermedia (rozas, tubos, cajas) |
| `deusto-bano-durante-alicatado.jpg` | Reforma baño Deusto | Alicatado en marcha |
| `deusto-bano-despues.jpg` | Reforma baño Deusto | La más reciente («baño terminado») |
| `durango-local-demolicion.jpg` | Adecuación local cafetería Durango | Demolición del local |

## Formato

- JPG, horizontal, **1600 × 1200 px**, **menos de 400 KB** cada una.
- Deben ser imágenes propias o libres de derechos: nada de fotos de obras de clientes reales.

## Servido

Se sirven en `/demo/obras/<archivo>.jpg`. El middleware ya excluye `.jpg` de la autenticación,
así que cargan sin sesión. Mientras falten, el diario sigue funcionando y solo se ve el hueco de la imagen.
