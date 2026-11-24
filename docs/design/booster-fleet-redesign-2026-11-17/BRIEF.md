# Brief de diseño — Booster Fleet

**Fecha:** 2026-11-17 · America/Santiago  
**Producto:** Booster AI — marketplace B2B de logística sostenible (Chile)  
**Superficie:** app autenticada, rol transportista (`dueno` / `admin`)  
**URL actual:** `https://app.boosterchile.com/app/booster-fleet`  
**Tenant de referencia (smoke interno):** transportista piloto — no versionar capturas ni PII en el repo

---

## 1. Problema

Booster Fleet ya funciona en producción (combustible 7 días, documentos, mantenciones), pero la UI es **listados de texto y tablas crudas**. El PO —usuario experto del dominio— no la encuentra intuitiva. El resto de la app autenticada comparte el mismo patrón: utilidad sin diseño de producto.

La promesa de marca (“Transporta más, impacta menos”; sentimiento *rápido / sin fricción / simple*; personalidad *buena onda*) está escrita en `DESIGN.md` y **casi no se ve** en esta pantalla. Las capturas de prod se adjuntan al diseñador por canal privado; no van en git.

## 2. Usuario y trabajo a hacer

**Usuario principal:** dueño (o admin) de una empresa de transportes. Bajo presión operativa. Necesita **potencia sin fricción** (DESIGN.md §4.2): densidad de información sí; paredes de texto no.

**Jobs (en este orden):**

1. **Combustible** — en segundos: ¿quién tiene problema? (robo, sin sensor, consumo alto, sin telemetría…)
2. **Documentos** — qué falta o vence pronto en vehículos y conductores, sin esconder hallazgos detrás de un conteo.
3. **Mantenciones** — qué está vencido / próximo; programar o cerrar sin pelear con el formulario.

**No es:** otra pantalla de seguimiento GPS (eso ya existe como “Seguimiento de flota”).

## 3. Qué está mal hoy (diagnóstico)

- Sin jerarquía de urgencia visual (crítico / atención / OK).
- Tres secciones equivalentes; el ojo no sabe por dónde empezar.
- Señal de dominio como prosa (“Sin equipo Teltonika”) sin chip/estado.
- Documentos = lista anidada de texto; no hay “próxima acción”.
- Mantenciones = lista + formulario plano al final.
- Layout genérico de dashboard SaaS; no se siente “producto Booster”.
- Tipografía/espaciado correctos a nivel token, pero **composición de dashboard ausente**.

## 4. Objetivo del rediseño

Proponer un **command center del dueño** para las tres áreas, alineado a `DESIGN.md`:

- Vara: claridad tipo **Stripe / Linear** (jerarquía impecable, cero decoración inútil).
- Alma: **buena onda** solo en momentos (vacíos, éxitos, confirmaciones) — no en tablas de datos.
- Registro **producto** (app autenticada): no fucsia comercial del marketing; verde de marca `#1FA058` con significado; ámbar = urgencia; danger = crítico.
- Desktop-first operador (también usable en tablet); no mobile-conductor.

## 5. Entregables pedidos a Claude Design

1. **3 direcciones visuales** distintas (A / B / C), no variaciones cosméticas del mismo layout.
2. Por dirección, artboards:
   - Overview Booster Fleet (viewport desktop ~1280–1440)
   - Una fila/vehículo en estado crítico expandido o panel lateral
   - Empty state de mantenciones
3. Prototipo clicable mínimo: overview → detalle de un hallazgo.
4. Notas de componentes reutilizables (KPI strip, SeverityBadge, FleetRow, DocAlert, MantencionCard).
5. Una página de **rationale** (por qué esta jerarquía ayuda al dueño).

## 6. Criterios de éxito del diseño (aceptación PO)

- En 3 segundos se entiende “qué está mal y cuántas cosas”.
- Combustible manda visualmente sobre documentos y mantenciones (orden de importancia de la spec).
- Cada hallazgo implica una acción o un destino claro (ficha vehículo/conductor).
- No parece un Excel exportado ni un admin CRUD de principiantes.
- Se puede implementar después con tokens existentes (`packages/ui-tokens`) sin inventar otra marca.

## 7. Fuera de alcance (no diseñar)

- Predicción de mantenciones.
- Editar / subir archivos documentales **en esta pantalla**.
- Cambiar tarifas o el segmentador de combustible.
- Rediseño completo de la plataforma (Fleet es el piloto).
- Login, marketing site, app del conductor voice-first.
