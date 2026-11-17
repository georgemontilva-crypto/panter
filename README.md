# Arena Panter

Web de Arena Panter, arena gamer en Maracaibo. React + Vite + TypeScript, sin base de datos.

## Comandos

```bash
npm install      # instala dependencias
npm run dev      # desarrollo en http://localhost:5173
npm run build    # revisa tipos y genera dist/
npm start        # sirve dist/ (lo que corre en producción)
```

## Dónde se cambia cada cosa

| Qué | Archivo |
| --- | --- |
| Textos, horario, evento, pases, WhatsApp, dirección | `src/content.ts` |
| Fotos de la arena | `src/assets/` (se importan en `src/components/Place.tsx`) |
| Logo vectorizado | `src/assets/logo.ts` |
| Colores y tipografía | `src/styles/base.css` (bloque `:root`) |

El contador, el estado "Abierto ahora" y la línea de tiempo del evento se calculan solos con la hora de Maracaibo (UTC-4).
Cuando pase el evento, la sección cambia sola a "Ya pasó" y oculta los botones de reserva.

## Despliegue en Railway

1. New Project → Deploy from GitHub repo → `panter`.
2. Railway detecta Node, corre `npm run build` y luego `npm start`.
3. En Settings → Networking, genera el dominio.

No requiere variables de entorno ni base de datos.
