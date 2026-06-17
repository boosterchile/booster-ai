# P2-7 — `recordStakeholderAccess` en endpoints ESG (Ley 19.628 Art. 12)

> ✅ **RESUELTO POR ANÁLISIS (2026-06-17)** — sin cambio de código. No hay
> incumplimiento de Art. 12 en vivo: **no existe ningún endpoint que sirva
> datos ESG/PII de terceros a un stakeholder**. La función de audit-log y el
> consent-check son scaffolding pre-construido y testeado para un read path que
> **aún no se cableó**. El requisito real (cablear ambos al construir ese
> endpoint) queda registrado abajo como guardrail.

**Dimensión**: security / compliance · **Esfuerzo original estimado**: S (verificación) · **Fuente**: audit 2026-06-14 (marcado "audit bloqueante")

## Hallazgo original (06-14)

Verificar que `recordStakeholderAccess` se invoca en todos los endpoints ESG —
Ley 19.628 Art. 12 exige registrar cada acceso de un stakeholder a datos
PII/ESG de terceros (ver ADR-028 §"Reglas inquebrantables §3").

## Verificación contra el código vivo (2026-06-17)

1. **`recordStakeholderAccess` (`apps/api/src/services/consent.ts:126`) tiene 0
   call sites reales.** Las únicas referencias no-test son JSDoc (`consent.ts:52,60`).
   La función inserta en `log_acceso_stakeholder` (schema `stakeholderAccessLog`,
   migración 0037) pero ningún handler la llama.

2. **`checkStakeholderConsent` (`consent.ts:62`), el guard del read path, también
   tiene 0 call sites reales** (solo un JSDoc en `me-consents.ts:23`). Si nadie
   chequea consent para servir data, es porque nadie sirve esa data.

3. **No existe ningún endpoint que sirva datos ESG/PII de terceros a un
   stakeholder.** Barrido de los mounts en `server.ts`:
   - `/consents` (`me-consents.ts`): solo **escritura** — el dueño otorga/revoca/
     lista consents (`grantConsent`/`revokeConsent`/`listConsentsGrantedBy`). Es
     el path donde un dueño autoriza a un stakeholder, NO donde el stakeholder lee.
   - `/certificates` (`certificates.ts`): **owner-scoped** —
     `requireShipperAuth` + `where generadorCargaEmpresaId = empresa propia`. El
     shipper ve **sus propios** certificados de huella; no es acceso de stakeholder
     a terceros → Art. 12 no aplica.
   - `/admin/stakeholder-orgs`: gestión admin de orgs stakeholder, no sirve datos ESG.
   - El path del ejemplo del propio docstring (`/me/stakeholder/portfolio/123/emissions`)
     **no está registrado** en ninguna ruta.

4. **Conclusión**: el sistema consent + audit-log (`grantConsent`, `revokeConsent`,
   `checkStakeholderConsent`, `recordStakeholderAccess`, tabla `log_acceso_stakeholder`)
   está completo y testeado, pero el **read path de stakeholder** que lo consumiría
   (observatorio / dashboard ESG, ADR-012 aspiracional) **no se construyó**. No hay
   endpoint que sirva datos ESG de terceros sin loguear — porque no hay endpoint que
   los sirva.

## Guardrail para cuando se construya el read path (requisito, NO ejecutar ahora)

Al implementar el primer endpoint que sirva datos ESG/PII de un tercero a un
stakeholder (observatorio / portfolio / emissions), el handler **DEBE**:

1. Llamar `checkStakeholderConsent(...)` **antes** de servir (authz).
2. Llamar `recordStakeholderAccess(...)` **después** de servir, con `bytesServed`
   y `httpPath` reales (Art. 12 audit), bloqueando la respuesta si la inserción
   falla (ADR-028 §3).

Recomendación de diseño (safe-by-construction): envolver ambos pasos en un único
helper `serveStakeholderData(opts, async () => payload)` que cheque consent →
ejecute el handler → registre el acceso atómicamente, de modo que sea **imposible**
servir datos sin loguear. Esto se construye **junto con** el primer endpoint, no
antes (YAGNI — mismo criterio que P1-F: no scaffolding para endpoints inexistentes).

> ⚠️ Para un auditor de cumplimiento hoy: la respuesta correcta es "el logging de
> acceso de stakeholder (Art. 12) está implementado y testeado; el read path que
> lo dispararía aún no está en producción — no hay accesos de stakeholder a datos
> de terceros que registrar". No es un hueco, es una capacidad aún no expuesta.

## NO ejecutar ahora

Diagnóstico + guardrail. No hay endpoint que arreglar. El requisito se activa con
el read path de stakeholder (futuro epic observatorio/ESG dashboard).
