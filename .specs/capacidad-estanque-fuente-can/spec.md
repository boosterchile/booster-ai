# Spec — Capacidad de estanque y fuente CAN de combustible

**Slug:** `capacidad-estanque-fuente-can`
**Brief:** P2, 2026-09-23. Por vehículo se persiste la capacidad del estanque en litros y la fuente CAN que el backend puede usar. No se adivina la fuente desde el censo en runtime.

**Frentes vivos:** `docs/frentes-vivos.md` (2026-09-13) no lista este frente. El brief lo encarga de forma explícita, con criterios de aceptación cerrados, igual que el historial de trayectos. No reabre un ADR.

## Entradas

- `POST /vehiculos` y `PATCH /vehiculos/:id` (el resto del body no cambia).
- `capacidad_estanque_l`: número, nullable. Si viene, `> 0` y `≤ 2000`.
- `fuente_combustible_can`: `84` | `83` | `89` | `sin_sensor`.
- Quién escribe esos dos campos: `dueno` | `admin`. El despachador sigue pudiendo crear y editar kg/m³ y el resto de la ficha, sin tocar estos campos.
- Lectura: `GET /vehiculos` y `GET /vehiculos/:id`.

## Salidas

- Columnas nuevas nullable. Filas existentes: `capacidad_estanque_l` null y `fuente_combustible_can = sin_sensor`. Un null legado de fuente se lee como `sin_sensor`.
- Create sin esos campos: capacidad null y fuente `sin_sensor`. Nunca se persiste `84` por omisión.
- `≤ 0`, no numérico o `> 2000` → 400 con mensaje claro. Fuente fuera del conjunto → 400.
- Otro rol que mande estos campos → 403 `admin_required`.
- Trayectos: la fuente configurada es la única que entra al cálculo. `sin_sensor` no inventa litros (km + CTA de sensor, igual que hoy sin sensor). `84` y `89` con IO usable y capacidad N convierten porcentaje × N. Sin capacidad, no hay litros y la nota dice que falta la capacidad, con CTA a la configuración. `83` usa solo el contador; si el IO no sirve, degradación explícita y sin litros inventados. El guardrail de km/L no se implementa en este frente.

## Mapeo AVL (Data Ops puede afinar después; este PR no pisa backfills manuales)

- **84 (JLKT54):** el raw del censo vale `20 × porcentaje` (el firmware asume estanque de 200 L). Porcentaje = `raw / 20`, válido solo en 0–100. Litros = `porcentaje / 100 × capacidad_estanque_l`. Con N = 200 L coincide con `raw × 0.1`. Fuera de 0–100 el IO no se usa.
- **83:** contador acumulado, `raw × 0.1` L, igual que el catálogo vigente. Se usa el Δ. No es nivel y no habilita el aviso de robo.
- **89:** porcentaje 0–100 directo. Si la fuente es `89` y hay capacidad N, litros = `porcentaje / 100 × N`. Data Ops (JLKT54): el IO 84 está deprimido ~4× frente a 89 × estanque (~200 L de firmware); por eso, con fuente 89, no se usa el 84. Sin capacidad no hay litros. JWTH77 sigue sin litros mientras la fuente quede en `sin_sensor`.

## Anti-robo

Con litros calculados y capacidad conocida, U del golpe sigue siendo `max(U_empresa, 2 % × capacidad)`. Sin capacidad, solo el umbral en litros. La hormiga y el pin no cambian de regla.

## Fuera de alcance

Alertas Slack/push/mail, autodetección de fuente en runtime, calibración avanzada, multi-estanque, CLP/L, cambios de hormiga o geo más allá de la capacidad para el %, UI masiva de flota.
