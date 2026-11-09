# Plan — Inicio del transportista, fase 1

## Archivos

- `apps/web/src/components/inicio-transportista/modelo.ts` — vista pura (saludo, filas, KPIs, accesos, alta). Sin red.
- `apps/web/src/components/inicio-transportista/use-datos-inicio.ts` — `useQuery` a los endpoints ya usados por ofertas, servicios, cumplimiento, flota, vehículos y conductores. Zod en el boundary. Misma `queryKey` que la pantalla de origen.
- `apps/web/src/components/inicio-transportista/inicio-transportista-vista.tsx` — UI con `Card`, `cn`, tokens semánticos y lucide.
- `apps/web/src/components/inicio-transportista/inicio-transportista.tsx` — une datos y vista.
- `apps/web/src/routes/app.tsx` — monta el inicio nuevo solo para transportista. Generador, sin empresa y sin operación no se tocan.
- `apps/web/src/routes/apariencia-inicio.tsx` — preview público (como `/apariencia/shell`) para capturas sin Firebase ni API.
- Tests junto a los módulos y actualización de `app.test.tsx`.

## Comprobación

1. `pnpm --filter @booster-ai/web test` sobre `app.test.tsx` y `modelo.test.ts`.
2. `pnpm --filter @booster-ai/web typecheck` y Biome sobre los archivos tocados.
3. Capturas del preview en 390 px y 1280 px: antes (lista de cards) y después (operación, vacío, error).

## Decisiones de ambigüedad (ver el cuerpo del PR)

- KPIs en grilla de 2 porque «Por cobrar» sale.
- Umbral sin señal: `CONECTADO_HASTA_S` (30 min), el de la lista de vehículos.
- «Sin GPS» = sin dispositivo Teltonika, o con reporte fresco pero sin coordenada válida.
- No hay campo `comuna`. Se usa el último tramo de `address_raw` si no tiene dígitos; si no, se omite.
- No hay listado de documentos vigentes a nivel empresa. El paso «documentos» del alta se considera pendiente cuando no hay vehículos ni conductores. El vacío de `/cumplimiento` no se lee como «nunca subió un documento» en una flota que ya opera.
