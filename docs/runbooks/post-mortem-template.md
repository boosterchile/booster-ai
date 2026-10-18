# Plantilla de post-mortem

Obligatorio para P0 y P1 ([`on-call.md`](on-call.md)) dentro de 5 días hábiles desde el cierre. Copiar a `docs/incidents/INC-YYYY-MM-DD-<slug>.md`; la fecha es la del inicio del incidente. Formato sin culpas: se analizan sistemas y decisiones, no personas. Ejemplo real: [`INC-2026-06-19`](../incidents/INC-2026-06-19-content-sid-placeholder-startup.md).

---

```markdown
# INC-YYYY-MM-DD — <qué falló, en una línea>

**Severidad**: P0 | P1 · **Estado**: cerrado | mitigado (acción pendiente)
**Detección**: <alerta / cliente / operador> · **Autor**: <quién escribe> · **Fecha del documento**: YYYY-MM-DD

## Resumen

Dos o tres frases: qué pasó, a quién afectó y cómo se resolvió.

## Impacto

- Usuarios o empresas afectados (cantidad y rol: generador de carga, transportista, conductor).
- Duración del impacto (inicio → fin, America/Santiago y UTC).
- Datos: ¿hubo pérdida, corrupción o exposición? ¿Viajes, huella, certificados o pagos afectados?
- Error-budget consumido por SLO (Cloud Monitoring → Services), si aplica.

## Línea de tiempo

| Hora (America/Santiago) | UTC | Evento |
|---|---|---|
| HH:MM | HH:MM | Primer síntoma (deploy, cambio, evento externo) |
| HH:MM | HH:MM | Alerta / detección |
| HH:MM | HH:MM | Acuse |
| HH:MM | HH:MM | Mitigación |
| HH:MM | HH:MM | Resolución confirmada (métrica en rango) |

Tiempo a detectar: X min · tiempo a acusar: X min · tiempo a mitigar: X min.

## Causa raíz

La cadena causal completa, con la evidencia (logs, commit, métrica). Si hay varias causas, numerarlas. "Error humano" no es una causa raíz: se pregunta qué permitió el error.

## Factores contribuyentes

Lo que agravó o retrasó: alertas ausentes o ruidosas, runbook desactualizado, falta de test, dependencia externa.

## Qué salió bien

Lo que funcionó y conviene preservar.

## Acciones

| Acción | Tipo (corrige / previene / detecta) | Dónde (PR / issue / spec) | Estado |
|---|---|---|---|
| | | | |

Cada acción correctiva entra como PR o issue; ninguna queda solo en este documento.

## Lecciones

Qué cambia en la forma de operar (runbook, umbral, contrato de `CLAUDE.md`). Si cambia una decisión fijada en un ADR, se escribe un ADR nuevo.
```
