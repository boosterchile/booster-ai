# Contexto de marca y dominio — Booster Fleet

Usar junto con `BRIEF.md` y `screenshots/`. Fuente canónica de identidad: `/DESIGN.md`.

---

## 1. Promesa y sentimiento

- Promesa: **Transporta más, impacta menos.**
- Sentimiento: **Rápido. Sin fricción. Simple.** (vara Stripe / Linear)
- Personalidad: **buena onda** (chilena): cercana sin ser informal; lúdica **solo en momentos** (vacíos, logros, confirmaciones). En tablas y formularios críticos: sobriedad.

## 2. Usuario de esta pantalla

Operador / dueño transportista — mundo **autenticado**, registro **producto**.  
Necesita densidad (tablas, filtros, estados) con potencia sin fricción. No es el conductor voice-first.

## 3. Tokens a respetar (`packages/ui-tokens`)

### Color

| Rol | Token | Hex |
|---|---|---|
| Brand / primary | `primary.500` | `#1FA058` |
| Primary oscuro (texto/botón) | `primary.600`–`700` | `#168047` / `#10653A` |
| Canvas cálido | `neutral.50` | `#FAF9F7` |
| Superficie | `neutral.0` | `#FFFFFF` |
| Texto principal | `neutral.900` | `#1A1917` |
| Texto secundario | `neutral.600` | `#56544F` |
| Bordes | `neutral.200` | `#E7E4DD` |
| Urgencia / atención | `urgency.500` / `warning.500` | `#F58A00` |
| Crítico | `danger` (semantic) | rojo del sistema — no usar primary para error |
| Éxito (estado, ≠ marca) | `success.500` | `#0E9F6E` |

**No usar** el fucsia comercial del marketing (`#d946ef`) en esta pantalla.

### Tipografía

- Sans: **Inter**
- Mono (patentes, IDs): **JetBrains Mono**
- Cuerpo operador: 14px (`sm`) en tablas; títulos densos, no display de marketing

### Forma

- Radius: botones/inputs `md` (8px), cards `lg` (12px)
- Sombras: mínimas; Stripe/Linear — jerarquía por tipografía y espacio, no por glow

## 4. Señales de dominio (contenido real)

### Combustible — por vehículo, la más grave gana

Orden de gravedad:

1. `posible_robo` → **crítico**
2. `sin_telemetria`
3. `sin_movimiento`
4. `sin_sensor`
5. `falta_capacidad`
6. `dato_no_confiable`
7. `consumo_alto` → **atención**
8. `en_orden` → **OK**

Ventana: últimos **7 días**. KPI de flota: L/100 km agregado cuando existe.  
Puede haber aviso de telemetría truncada.

### Documentos

- Vehículo obligatorio: revisión técnica, permiso de circulación, SOAP  
- Conductor obligatorio: licencia, examen psicotécnico  
- Estados: `vencido`, `faltante`, `sin_fecha`, `sin_archivo`, `por_vencer` (≤30 días), `vigente`

### Mantenciones

- Estados abiertos: `vencida`, `proxima` (≤15 días), `programada`  
- Cerrados: `realizada`, `cancelada` (no vuelven al panel)  
- Tipos: preventiva, correctiva, inspección  
- Camión en taller = estado vehículo `mantenimiento`

## 5. Datos de ejemplo para el mock (sintéticos)

Usá **datos inventados** en los artboards (patentes y nombres ficticios). No copiar PII ni patentes reales de capturas de prod al repo ni a exports públicos.

Forma típica de la pantalla actual (para calibrar densidad, no para copiar identidad):

- Varios vehículos con alerta (sin telemetría / sin sensor) y pocos “En orden”
- KPI de flota L/100 km + posible aviso de telemetría truncada
- Documentos: muchos hallazgos en vehículos y conductores
- Mantenciones: a menudo vacías al inicio → empty state importa

## 6. Shell actual (no rediseñar entero, sí respetar contexto)

- Sidebar izquierda con empresa activa (“Transportes Van Oosterwyk”)
- Sección TRANSPORTE; ítem **Booster Fleet**
- El rediseño puede **proponer** mejoras al área de contenido; el chrome del shell puede quedar como marco o sugerirse en una nota, sin ser el foco

## 7. Anti-patrones (evitar)

- Paredes de texto / listados sin prioridad  
- Cards decorativas en el hero del panel  
- Purple gradients, glassmorphism, glow, pills de moda genérica  
- Dashboard con 12 KPIs irrelevantes  
- Ilustraciones stock de camiones  
- Dark mode por defecto  
- Mezclar registro comercial (fucsia) con producto  

## 8. Referencias en el repo

- Identidad: `DESIGN.md`  
- Spec: `.specs/booster-fleet/spec.md`  
- Tokens: `packages/ui-tokens/src/`  
- UI actual (código): `apps/web/src/routes/booster-fleet.tsx`  
