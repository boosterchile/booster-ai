# BUG-001 — "Crear carga" acepta ventanas de pickup imposibles y direcciones triviales

| | |
|---|---|
| **Severidad** | 🔴 Crítico |
| **Componente** | `/app/cargas/nueva` (cliente) + `POST /trip-requests-v2` (servidor) |
| **Detectado** | 2026-05-04 |
| **Test** | `tests/bugs/cargas-validation.spec.ts` |

## Descripción

El form de "Crear carga" no valida la coherencia de la ventana de pickup ni la
longitud mínima de las direcciones. La carga se persiste, el `matching_engine`
se dispara y se envían ofertas a transportistas con datos imposibles.

## Repro (5 casos confirmados)

| # | `pickup_start` | `pickup_end` | Origen | Resultado |
|---|---|---|---|---|
| 1 | 2026-05-10 14:00 | 2026-05-10 10:00 (4h antes) | normal | ✅ creada `BOO-GFZLEI`, ofertas enviadas |
| 2 | 2026-12-15 10:00 | 2026-12-15 10:00 (idénticos) | normal | ✅ creada `BOO-B8WNAC` |
| 3 | 2026-06-15 10:00 | 2027-06-15 10:00 (1 año) | normal | ✅ creada `BOO-6N8634` |
| 4 | 2020-01-01 14:00 | 2020-01-01 16:00 (en el pasado) | normal | ✅ creada `BOO-BWV63J` |
| 5 | 2026-06-15 10:00 | 2026-06-15 12:00 | `.` y `x` (1 char) | ✅ creada `BOO-WWG6TW` |

## Constraints actuales (verificadas)

```ts
// /app/cargas/nueva — atributos HTML del form
pickup_start_local: { type: 'datetime-local', required: true /* sin min ni max */ }
pickup_end_local:   { type: 'datetime-local', required: true /* sin min ni max */ }
origin_address_raw: { type: 'text', required: true, maxLength: 500 /* sin minLength ni pattern */ }
destination_address_raw: { type: 'text', required: true, maxLength: 500 /* sin minLength */ }
cargo_weight_kg:    { type: 'number', required: true, min: 1, max: 100000 } // ← este sí valida
```

El servidor (Zod schema en `POST /trip-requests-v2`) tampoco valida estas
relaciones — al menos no de forma observable: el endpoint responde 201 en
todos los casos anteriores.

## Esperado

- `pickup_end > pickup_start` (estrictamente).
- `pickup_start >= now() + N` (N configurable, sugerido 1 h).
- `pickup_end - pickup_start <= 30 días` (rango razonable).
- Direcciones `minLength=5` mínimo + idealmente geocoding al blur.
- Validación replicada cliente y servidor.

## Actual

Ninguna de las 4 reglas se valida. La carga llega a producción y dispara el
matching engine, gastando notificaciones (WhatsApp/email a transportistas) e
incentivando rechazos que erosionan la confianza del marketplace.

## Fix sugerido

**Cliente** (`react-hook-form` + `zod`):
```ts
const cargaSchema = z.object({
  origin_address_raw: z.string().trim().min(5).max(500),
  destination_address_raw: z.string().trim().min(5).max(500),
  pickup_window_start: z.string().refine(
    (s) => new Date(s).getTime() > Date.now() + 60 * 60 * 1000,
    'La ventana debe empezar al menos 1 hora en el futuro',
  ),
  pickup_window_end: z.string(),
}).refine(
  (d) => new Date(d.pickup_window_end) > new Date(d.pickup_window_start),
  { path: ['pickup_window_end'], message: '"Hasta" debe ser posterior a "Desde"' },
).refine(
  (d) => new Date(d.pickup_window_end).getTime() - new Date(d.pickup_window_start).getTime() <= 30 * 24 * 60 * 60 * 1000,
  { path: ['pickup_window_end'], message: 'La ventana no puede exceder 30 días' },
);
```

**Servidor**: copiar el mismo schema en el handler. Defensa en profundidad.

## Datos de prueba creados

Las 5 cargas listadas arriba fueron canceladas durante la exploración. Quedan
en `/app/cargas` historial con estado `Cancelado` y motivo descriptivo.
