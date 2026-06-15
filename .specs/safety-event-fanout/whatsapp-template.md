# WhatsApp template — `safety_alert_v1`

Listo para submitear en **Twilio Content Editor** (Content Template Builder) → se aprueba vía Meta. Categoría **UTILITY** (notificación transaccional, no marketing → aprobación más rápida y enviable fuera de la ventana de 24h).

---

## Metadatos

| Campo | Valor |
|---|---|
| **Template name** | `safety_alert_v1` (Twilio exige snake_case minúscula) |
| **Category** | UTILITY |
| **Language** | Spanish (es) |
| **Content type** | `twilio/text` (body-only) — ver abajo variante con botón |

## Header (opcional, texto estático)

```
🚨 Alerta de seguridad — Booster
```

## Body

```
Detectamos un evento de seguridad en un vehículo de tu flota.

Vehículo: {{1}}
Evento: {{2}}
Hora: {{3}}
Viaje: {{4}}

Revisá el estado del vehículo y contactá al conductor si es necesario.
```

## Footer (opcional, estático)

```
Booster · Logística sostenible
```

## Variables — sample values (Meta los exige para aprobar)

| Var | Significado (app) | Sample para el submit |
|---|---|---|
| `{{1}}` | Patente o alias del vehículo | `RJXK-42` |
| `{{2}}` | Tipo de evento (label es) | `Posible colisión` |
| `{{3}}` | Hora local del evento | `14:32 (15 jun)` |
| `{{4}}` | tracking_code del viaje, o "Sin viaje activo" | `BOO-7F3A2C` |

**Labels de `{{2}}` que usará el código** (para que el sample sea representativo):
- `crash` → `Posible colisión`
- `unplug` → `Desconexión de energía (manipulación)`
- `jamming` → `Interferencia de señal GPS`

## Variante con botón (opcional — si querés CTA directo)

Agregar un **botón URL dinámico**:
- Texto del botón: `Ver vehículo`
- URL: `https://app.boosterchile.com/app/flota?v={{1}}`
- Sample para `{{1}}` del botón: `6487dac2`

> Nota: el botón con URL dinámica agrega una variable extra y a veces alarga la revisión de Meta. Si querés la aprobación más rápida, submití **body-only** primero; el deep-link igual va por push. El botón se puede agregar en `safety_alert_v2` después.

## Después de aprobar

Meta devuelve el Content SID (`HX...`). Setealo en la env del Cloud Run del api como `CONTENT_SID_SAFETY_ALERT`. Hasta entonces, el código skipea WhatsApp y notifica solo por push (sin romper nada).

## Checklist de submit

- [ ] Crear template en Twilio Content Editor, name `safety_alert_v1`, category UTILITY, language Spanish.
- [ ] Pegar header / body / footer de arriba.
- [ ] Cargar los 4 sample values.
- [ ] Submit a Meta.
- [ ] Al aprobar (24-48h): copiar el `HX...` → `CONTENT_SID_SAFETY_ALERT` en Cloud Run.
