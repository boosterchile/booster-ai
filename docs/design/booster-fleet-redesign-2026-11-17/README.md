# Paquete de diseño — Booster Fleet (2026-11-17)

**Para:** Claude Design (o cualquier herramienta de propuesta visual).  
**Pedido:** PO — rediseñar la UI de Booster Fleet; el resto de la plataforma se siente básica.  
**Autoridad de marca:** `DESIGN.md` en la raíz del repo (PO).  
**Spec funcional (no se reabre):** `.specs/booster-fleet/spec.md`.

## Cómo usarlo en Claude Design

1. Abrí Claude Design / Artifacts → Design.
2. Adjuntá (o pegá) en este orden:
   - `PROMPT-CLAUDE-DESIGN.md` (el pedido completo, listo para pegar)
   - `CONTEXT.md` (identidad + tokens + restricciones)
   - Screenshots de la UI actual **solo por canal privado** (chat Claude Design / Drive interno). **No versionar capturas de prod** en este repo (PII, patentes, overlay de login).
3. Si Claude Design puede leer el repo: apuntá también a `DESIGN.md` y `packages/ui-tokens/src/`.
4. Pedí **2–3 direcciones** (no una sola), desktop-first operador, con artboards:
   - Overview Booster Fleet
   - Detalle / drill-down de un vehículo con alerta
   - Estado vacío de mantenciones (con “buena onda” dosificada)

## Contenido

| Archivo | Qué es |
|---|---|
| `PROMPT-CLAUDE-DESIGN.md` | Brief + prompt listo para pegar |
| `BRIEF.md` | Problema, usuario, jobs, criterios de éxito del diseño |
| `CONTEXT.md` | Identidad Booster, tokens, señales de dominio, fuera de alcance |

Capturas de referencia para el PO: quedaron fuera de git (p. ej. artifacts del agente). Adjuntarlas a mano en Claude Design.

## Fuera de este paquete

No rediseña login, marketing, ni toda la app. Fleet es el **piloto**. La tarifa, el segmentador de combustible y la edición de archivos en pantalla siguen fuera de alcance (spec § fuera de alcance).
