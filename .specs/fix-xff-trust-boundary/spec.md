# Spec: fix-xff-trust-boundary

- Author: Felipe Vicencio (with agent-rigor)
- Date: 2026-06-11
- Status: Approved
- Linked: REVIEW de sec-rate-limit-login-rut (security ALTO, 2026-06-10) → `.specs/_followups/xff-trust-boundary-resto-endpoints.md`. PR #437 corrigió rate-limit-pin; este ciclo cierra el resto.

## 1. Objective

Unificar la extracción de IP cliente confiable en un util compartido (penúltima entry del `X-Forwarded-For` — la primera es 100% controlada por el atacante bajo GCLB) y aplicarlo a los dos sitios que siguen tomando `[0]`: `rate-limit-signup.ts` (endpoint anónimo de captación en prod — su counter per-IP es anulable rotando XFF falsos) y `demo-cache-warm.ts`.

## 2. Why now

P1 del follow-up: signup-request es anónimo y está en producción; el límite 5/15min/IP es su única defensa aplicativa y hoy es bypasseable.

## 3. Success criteria

- [ ] `apps/api/src/middleware/client-ip.ts` exporta `extractClientIp` (penúltima entry; 1 entry → esa; ausente/vacío → 'unknown') con tests propios.
- [ ] rate-limit-pin, rate-limit-signup y demo-cache-warm usan el util (cero copias locales; `git grep "split(',')"` en middleware/routes solo encuentra el util).
- [ ] Test de spoofing (XFF multi-entry) en rate-limit-signup.

## 4. User-visible behaviour

Ninguno para clientes legítimos; atacantes rotando XFF dejan de evadir los counters per-IP.

## 5. Out of scope

- Reset-on-success del counter per-RUT del login (sigue en el follow-up; UX, no trust boundary).
- Otros consumidores de XFF fuera de apps/api (grep: no hay).

## 6. Constraints

1. Semántica idéntica a la versión ya revisada/mergeada de rate-limit-pin (#437): única fuente de verdad.

## 7. Approach

Mover la implementación canónica a client-ip.ts; los 3 call-sites importan; tests del util + caso spoof en signup.

## 8. Alternatives considered

- **A. Dejar copias locales corregidas en cada archivo** — Rechazada: tres copias = drift garantizado (así nació este bug).
- **B. Confiar en un header de LB dedicado (X-Real-IP)** — Rechazada: GCLB no lo setea por defecto; XFF penúltima es el contrato documentado de Google.

## 9. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Topología cambia (otro proxy delante del LB) | L | M | Comentario del util documenta el supuesto GCLB; un hop extra movería la IP confiable a len-3 — anotado |

## 10. Test list

- T1: util — multi-entry spoofeado → penúltima; single → esa; vacío/ausente → unknown; espacios/entries vacías filtradas.
- T2: rate-limit-signup con XFF spoofeado multi-entry → key de la IP del LB, no la del atacante.
- T3: demo-cache-warm compila contra el util (cobertura vía suite existente).

## 11. Rollout

- Flag: no. Migración: no. Rollback: revert.
- Monitoring: logs de 429 de signup ya incluyen ip — verificar distribución post-deploy.

## 12. Open questions

None as of 2026-06-11.

## 13. Decision log

- 2026-06-11 — Draft + mandato PO (cierre del follow-up P1).
