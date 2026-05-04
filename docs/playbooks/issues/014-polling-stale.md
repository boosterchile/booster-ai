# BUG-014 — "Polling cada 30s" prometido pero sin indicador cuando el dato está stale

| | |
|---|---|
| **Severidad** | 🟡 Menor (UX) |
| **Componente** | `/app/cargas/<id>` y `/app/cargas/<id>/track` |
| **Detectado** | 2026-05-04 |

## Descripción

La vista detalle de carga muestra:
> "Última posición GPS reportada. Polling cada 30s."

La vista `/track` muestra (cuando aplica):
> "Actualizado: hace 26 h 23 min" (en rojo).

Inconsistencia: la vista detalle promete un polling cada 30 segundos sin
caveat, pero si el dispositivo del vehículo está apagado o sin señal, el
dato puede tener horas. La única vista que lo señala es la fullscreen
`/track`.

## Repro

1. Carga `BOO-4XZH2K` (asignada).
2. Vista detalle → "Polling cada 30s" — sin warning de freshness.
3. "Ver en vivo" → "Actualizado: hace 26 h 23 min" en rojo.

## Esperado

- Mostrar el `timestamp_device` reportado en ambas vistas.
- Si pasaron > N minutos (sugerido 5), mostrar warning amarillo/rojo.
- En la copy, separar "polling de la API cliente" (cada 30s) de "frecuencia
  de reporte del dispositivo" (depende del vehículo).

## Fix sugerido

```tsx
<TrackingCard>
  <h2>Ubicación del vehículo</h2>
  <p className="text-sm text-neutral-500">
    Última posición reportada por el dispositivo: {' '}
    <RelativeTime
      date={ubicacion.timestamp_device}
      stale={Duration.minutes(5)}
      className={isStale ? 'text-rose-600' : 'text-neutral-700'}
    />
    {isStale && (
      <span className="ml-2 text-xs">
        (el dispositivo puede estar fuera de cobertura)
      </span>
    )}
  </p>
  <Map ... />
</TrackingCard>
```
