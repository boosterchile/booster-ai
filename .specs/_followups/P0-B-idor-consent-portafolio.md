# P0-B 🔒 — IDOR en consent ESG `portafolio_viajes`

**Dimensión**: security · **Estado**: requiere revisión legal (consentimiento sobre datos de terceros).
**Fuente**: audit 2026-06-14

## Problema
`apps/api/src/routes/me-consents.ts:85-95`: para `scope_type === 'portafolio_viajes'` solo se valida que el user tenga alguna membership activa (`eq(memberships.userId, ...)`), sin filtrar por rol ni empresa, y sin validar que `scope_id` corresponda a trips del otorgante. El propio código tiene comentario "P1: validar que TODOS los trips del portafolio sean de empresas donde el user es dueño/admin".

## Impacto
Un usuario con rol `visualizador`/`conductor` puede otorgar grants ESG sobre trips de otra empresa → consentimiento inválido sobre datos de terceros. Viola ADR-028 y Ley 19.628 Art. 4.

## Plan de pago
Resolver junto con **P1-B** (mismo módulo, scopes `generador_carga`/`transportista`/`organizacion`, líneas 98-106) en un solo PR de hardening:
1. TDD-first (dominio crítico auth/consent → `tdd-dominio-critico` obligatorio).
2. Validar que `scope_id` pertenezca a una empresa donde el user es `dueno`/`admin`.
3. Añadir `eq(memberships.empresaId, scopeId)` y filtro de rol al WHERE.
4. Test de integración que cubra el caso IDOR (grant rechazado sobre empresa ajena).
5. Revisión legal del modelo de consentimiento antes de merge.

## NO ejecutar ahora
Diagnóstico. El fix es trabajo aparte (spec → test-first → review legal).
