# Ship: marketing-site-signup-request

- Fecha: 2026-06-08
- Rama: `feat/marketing-site-signup-request` (13 commits sobre `main`)
- Review verdict: **Approved for /ship (gateado)** (ver `review.md` §REVIEW)
- **Tipo de ship: GATEADO** — merge del código a `main`; **sin deploy a producción ni encendido del `/signup`** en este ciclo. El sitio no se mapea a DNS y el form queda en "próximamente" (`NEXT_PUBLIC_SIGNUP_ENABLED=false`). El flip a captación lo gobierna §11 del spec (CORS + downstream + Ley 19.628 + E2E).

## Checklist 12 puntos

| # | Ítem | Estado |
|---|---|---|
| 1 | Tests verdes en el merge commit | ⏳ se valida en CI del PR. Local: **61/61, coverage 100%, build standalone OK, biome 0, tsc 0**. CI = jobs monorepo (turbo + biome) que ya cubren marketing (T9). |
| 2 | Changelog | `[waiver: app privada 0.0.0 sin publish; el repo usa Changesets solo para packages versionados. apps/marketing no publica.]` |
| 3 | Version bump | `[waiver: app privada 0.0.0; no hay release SemVer de un app no publicado.]` |
| 4 | Migration guides (si breaking) | N/A — no breaking. ADR-060 supersede ADR-010 §signup/§checkout (documentado; ADR-010 nunca se implementó). |
| 5 | Feature flags | ✓ `NEXT_PUBLIC_SIGNUP_ENABLED` off por default (kill-switch del form; build-time). |
| 6 | Rollback plan | ✓ ver §Rollback. |
| 7 | Reversibilidad | ✓ app aislada en runtime (`apps/marketing`), sin efectos en api/web, **sin migración DB**, sin tráfico prod (no desplegada). **Nota (devils SHIP P1-B)**: el `pnpm build` root (job `build` de CI) ahora incluye `next build` de marketing — el quality gate de `main` se acopla a que marketing compile. **Decisión: aceptado** — un build de sitio estático es estable, y el build ES un gate válido; no se aísla del monorepo. |
| 8 | Telemetría | N/A hasta el encendido — el monitoreo (202/429/503, `signup_email_sent`) se activa con el flip (§11). |
| 9 | Secrets / config | ✓ gitleaks limpio; sin secretos; `NEXT_PUBLIC_*` seguras de exponer (URL pública + flag); `.env.example` presente. |
| 10 | Docs | ✓ ADR-060 (→ Accepted), `spec/plan/verify/review.md`, `.env.example`, follow-ups (`marketing-lighthouse-blocking`, `onboarding-flow-redesign`). |
| 11 | Comunicación | ✓ PR a `main` (este ship); nota al PO sobre el estado gateado + condiciones del flip. |
| 12 | Rollback rehearsed | `[waiver: el cambio no toca auth/money/data en prod (no DB, no deploy, no tráfico). El rollback es git revert del merge — trivial y sin estado que restaurar.]` |

## Rollback

- **Pre-merge**: cerrar el PR.
- **Post-merge**: `git revert` del squash-merge. La app es aislada — revertir no afecta `apps/api`/`apps/web` (no comparten runtime; los `packages/*` consumidos no cambiaron). Sin migración DB que revertir. **Caveat (devils SHIP)**: el revert incluye `pnpm-lock.yaml` (+527 líneas, deps next/react-hook-form/tailwind4); si otro PR tocó el lockfile en la ventana, el revert puede tener conflicto en el lock — resoluble con `pnpm install`.
- **Si ya estuviera desplegada (no en este ciclo)**: el kill-switch off ya deja `/signup` inerte; además no está en el pipeline de deploy (`release.yml`) ni mapeada a DNS.

## Post-merge verification

- CI verde en el commit de `main` tras el squash-merge.
- Confirmar que `apps/marketing` NO está en `release.yml` (el merge no debe disparar un deploy de marketing).
- ADR-060 promovido a Accepted.

## Gate de encendido (NO en este ship — ref §11)

Encender `/signup` (flip `NEXT_PUBLIC_SIGNUP_ENABLED=true`, que requiere **rebuild+redeploy**) exige, en orden:
1. `www.boosterchile.com` en `CORS_ALLOWED_ORIGINS` + preflight OPTIONS verificado en staging.
2. `SIGNUP_REQUEST_FLOW_ACTIVATED=true` + bug 409 approve↔onboarding cerrado + notifier email real (`onboarding-flow-redesign`).
3. Ley 19.628: `/legal/privacidad` definitiva + consentimiento/finalidad en el form.
4. E2E de signup + Lighthouse en verde (`marketing-lighthouse-blocking`).

## Handoff de merge

- Remote real = **GitHub** `boosterchile/booster-ai` (NO `origin`/GitLab). Push vía remote `github`.
- Fix de coaching independiente: `fix/web-test-localstorage-polyfill` → PR #425 (sin orden estricto vs este; tocan archivos distintos, CI verde en Node 24 igual).

## Devils-advocate (SHIP)

Corrido el sub-agent sobre `ship.md` + rollback. **Veredicto: seguro pushear+PR+merge gateado; 0 P0/blocker.** Verificó en código vivo: nada se despliega (sin Dockerfile/step de marketing en cloudbuild), endpoint ya montado e inerte por downstream gateado (`server.ts:231/554`, `config.ts:479`), kill-switch fail-closed (`env.ts:19`), revert viable.

Objeciones P1 (cerradas antes del push):
- **P1-A**: el comentario de `apps/marketing/src/app/signup/page.tsx` AÚN afirmaba el "doble nivel CORS" falso (corregí el ADR pero no el código). **Fix**: comentario reescrito acorde a ADR-060 §"Aclaración de seguridad".
- **P1-B**: el merge acopla el gate de CI de `main` al `next build` de marketing (verificado: turbo build sin filtro lo incluye). **Decisión registrada** en ítem 7: aceptado (build estático estable).

Residuales: comentario obsoleto en `cloudbuild.production.yaml:15` (corregido); revert incluye lockfile (caveat en §Rollback); F2 (flag mal seteado al desplegar) gobernado por §11.

## Postmortem (inmediato; revisable a 24h)

- **Qué funcionó**: el ciclo adversarial atrapó cosas reales que el verde no — el `main` 239 commits stale (que invalidó el feature previo), el claim de seguridad CORS falso (devils REVIEW + SHIP), y 4 BLOCKING de a11y. El kill-switch fail-closed + ship gateado permitió entregar valor (SEO) sin el downstream listo.
- **Qué sorprendió**: el mismo claim falso ("defensa CORS de doble nivel") sobrevivió en DOS lugares — lo corregí en el ADR en REVIEW pero el comentario del código siguió mintiendo hasta que el devils SHIP lo cazó. Fix de doc incompleto.
- **Qué haría distinto**: (1) verificar frescura del `main` vs remoto al inicio de sesión (ahora en memoria); (2) al corregir una afirmación, hacer `grep` de todas sus apariciones (ADR + código + spec), no solo la primera.
- **PR**: #426 (a `main`, gateado).
