# FIX-014 — Indicador de "stale" cuando el GPS no actualiza

> **Severidad**: 🟡 Menor (UX)
> **Issue**: [../issues/014-polling-stale.md](../issues/014-polling-stale.md)
> **Test**: agregar test al fix

## 1. Resumen

`/app/cargas/<id>` muestra "Última posición GPS reportada. Polling cada
30s" sin caveat. Pero el dato puede tener horas si el dispositivo está
apagado/sin señal — `/track` lo señala con timestamp en rojo, la otra
vista no.

## 2. Plan

1. Mostrar `timestamp_device` en ambas vistas con tiempo relativo.
2. Si pasaron > 5 min, mostrar warning amarillo; > 1h, rojo.
3. Diferenciar en el copy: "polling de la API" (cliente) vs "frecuencia
   de reporte del dispositivo" (depende del vehículo).

## 3. Localización

```bash
grep -rn "Polling cada 30s\|timestamp_device\|Última posición GPS\|Reportado" \
  apps/ src/ --include="*.tsx"

grep -rn "ubicacion_actual\|gps.*report\|TrackingCard" \
  apps/ src/ --include="*.tsx"
```

## 4. Implementación

### 4.1 Componente `<RelativeTime>`

```tsx
// components/RelativeTime.tsx
'use client';
import { useEffect, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

interface Props {
  date: string | Date;
  staleMinutes?: number;   // default 5
  oldHours?: number;       // default 1
  className?: string;
}

export function RelativeTime({ date, staleMinutes = 5, oldHours = 1, className }: Props) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const ts = typeof date === 'string' ? Date.parse(date) : date.getTime();
  const diffMinutes = (now - ts) / 60_000;

  let toneClass = 'text-neutral-700';
  if (diffMinutes > oldHours * 60) toneClass = 'text-rose-600 font-medium';
  else if (diffMinutes > staleMinutes) toneClass = 'text-amber-600';

  const text = formatDistanceToNow(ts, { addSuffix: true, locale: es });

  return (
    <time
      dateTime={new Date(ts).toISOString()}
      className={`${toneClass} ${className ?? ''}`}
      title={new Date(ts).toLocaleString('es-CL')}
    >
      {text}
    </time>
  );
}
```

### 4.2 Vista detalle de carga

```tsx
// /app/cargas/[id]/page.tsx (sección Ubicación del vehículo)
<section>
  <h2>Ubicación del vehículo</h2>
  <p className="text-sm text-neutral-500">
    Reportado por el dispositivo:{' '}
    <RelativeTime date={ubicacion.timestamp_device} />
    {isStale(ubicacion.timestamp_device) && (
      <> · El dispositivo puede estar fuera de cobertura.</>
    )}
  </p>
  <p className="text-xs text-neutral-400 mt-1">
    Esta vista se actualiza cada 30 segundos.
  </p>
  <Map … />
</section>
```

> **Cambio de copy**: separar "polling de la app" de "frecuencia del
> dispositivo".

### 4.3 Vista `/track`

Reusar el mismo componente. La diferencia entre ambas vistas debería ser
solo la presentación (fullscreen vs card), no el comportamiento.

### 4.4 Helper `isStale`

```ts
// lib/freshness.ts
export function isStale(timestamp: string | Date, minutes = 5): boolean {
  const ts = typeof timestamp === 'string' ? Date.parse(timestamp) : timestamp.getTime();
  return Date.now() - ts > minutes * 60_000;
}
```

## 5. Test

```ts
// tests/bugs/gps-freshness.spec.ts
import { test, expect } from '@playwright/test';

test.describe('FIX-014: indicador GPS stale @bug', () => {
  test('vista detalle muestra timestamp del último report', async ({ page }) => {
    await page.goto('/app/cargas/<id-de-prueba>');
    await expect(page.getByText(/Reportado por el dispositivo:/)).toBeVisible();
    await expect(page.locator('time[datetime]')).toBeVisible();
  });

  test('si reporte > 5 min, color amarillo o rojo', async ({ page }) => {
    // requiere fixture con dato stale; alternativa: mockear API con MSW
    await page.goto('/app/cargas/<id-con-dato-viejo>');
    const time = page.locator('time[datetime]').first();
    const cls = await time.getAttribute('class');
    expect(cls).toMatch(/text-(amber|rose)-/);
  });
});
```

> Si no existe fixture con dato viejo, el segundo test puede ser manual o
> bien mockear la respuesta API.

## 6. Verificación manual

| Escenario | Esperado |
|---|---|
| GPS reportó hace < 5 min | Texto neutro: "hace 2 minutos". |
| GPS reportó hace 30 min | Texto amarillo: "hace 30 minutos". |
| GPS reportó hace 5 horas | Texto rojo: "hace 5 horas" + "fuera de cobertura". |
| Hover sobre el tiempo | Tooltip con fecha completa. |

## 7. Definition of Done

- [ ] `<RelativeTime>` y helper `isStale` creados.
- [ ] Vista detalle y `/track` usan el mismo componente.
- [ ] Copy diferencia "polling app" de "reporte del dispositivo".
- [ ] Test verde.
- [ ] Manual de los 4 escenarios.
- [ ] Commit `feat(tracking): indicador de freshness de GPS (BUG-014)`.
