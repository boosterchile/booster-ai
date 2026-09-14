# Spec — chore: el gate del canary exige muestra mínima (30 requests)

**Slug**: `chore-canary-min-requests` · **Rama**: `chore/canary-min-requests` ·
**Fecha**: 2026-08-16 · **Autorización PO**: instrucción directa en sesión
2026-08-16 («prepara el PR del min_requests») tras el incidente del deploy.

## Problema

Incidente 2026-08-16 (release run 31957237538): `canary-verify` abortó el deploy
con `requests=6 5xx=0 p95_max=1408ms → FAIL p95 >= 500ms`. Con n=6 el p95 es el
máximo y 1.4s es cold-start, no degradación — falso positivo. La causa
habilitante: `_CANARY_MIN_REQUESTS: '0'` hace que CUALQUIER n ≥ 1 evalúe los
SLOs, sin piso de muestra. El branch de protección ya existe en el script
(review 2026-06-11: `>0 = muestra insuficiente aborta, promoción exige decisión
humana`) pero con `'0'` nunca aplica.

Ver memoria `canary-verify-falso-positivo-p95-2026-08` y
`.specs/fix-vehiculos-form-validacion/` (el deploy que lo destapó).

## Alcance

Solo `cloudbuild.production.yaml`:

1. `_CANARY_MIN_REQUESTS: '0'` → `'30'` (≈1 req/min en la ventana de 30 min;
   mismo orden que los 30 probes del synthetic monitor descrito en
   `canary-sleep`). NO se cambia la semántica del branch (muestra insuficiente
   ABORTA — decisión documentada 2026-06-11 que este PR respeta): el objetivo es
   que un deploy con tráfico bajo falle con el mensaje honesto y accionable, no
   con un p95 de cold-start engañoso.
2. Los mensajes de FAIL (`muestra insuficiente`, `error_rate`, `p95`) incluyen
   el paso siguiente para el on-call: verificación manual + comando de
   promoción (`gcloud run services update-traffic … --to-revisions=<REV>=100`),
   runbook ejercitado hoy.
3. Comentario de la substitution actualizado con la referencia del incidente.

**No se toca**: `release.yml` (solo pasa `_COMMIT_SHA`; el default vive en el
yaml de Cloud Build), la lógica python del gate (mismo flujo, solo strings), ni
el no-atomicidad del pipeline (los deploys paralelos de web/bot/processors ante
un abort del canary — limitación conocida, frente aparte si el PO lo prioriza).

## Criterios de éxito

- [ ] YAML parsea (`python3 -c "yaml.safe_load"`).
- [ ] Diff acotado: valor de substitution + strings de mensajes + comentarios.
- [ ] Sin `$` sin escapar nuevos en los strings (Cloud Build interpreta `${…}`;
      los placeholders van como `<REV>`).
- [ ] Simulación local del branch de muestra: (n=6, min=30) → FAIL muestra
      insuficiente; (n=35, min=30) → evalúa SLOs; (n=0, min=30) → FAIL.
- [ ] Consecuencia operativa documentada en el PR: deploys en ventana de poco
      tráfico (fin de semana) abortarán con «muestra insuficiente» — el PO
      decide promover a mano o re-despachar en horario con tráfico.
