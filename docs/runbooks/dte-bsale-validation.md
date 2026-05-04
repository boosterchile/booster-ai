# Runbook — Validación BsaleAdapter contra sandbox SII

**Snapshot**: 2026-05-04
**Owner**: equipo backend Booster AI
**Frecuencia**: pre-merge de PR #29, post-cambios de spec Bsale, pre-go-live producción

---

## Cuándo correr

1. **Pre-merge** de PR #29 (`feat/dte-provider-bsale-adapter`) — confirmar que el field mapping en `packages/dte-provider/src/bsale.ts` matchea la API real de Bsale al momento del merge.
2. **Cuando Bsale anuncie breaking changes** en su API (revisar https://api.bsale.dev/changelog periódicamente).
3. **Pre-promoción a producción** — al transicionar de sandbox SII (https://maullin.sii.cl) a producción SII (https://palena.sii.cl).
4. **Después de rotar el certificado digital del emisor** en Secret Manager.

## Prerrequisitos

- [ ] Cuenta Bsale activa (o sandbox account si Bsale lo expone públicamente).
- [ ] API token Bsale generado en panel admin de la cuenta. Persistido en pass manager / env local; NUNCA en el repo.
- [ ] RUT emisor de prueba inscrito en SII certification (`https://maullin.sii.cl`). Si no existe, registrarlo siguiendo [SII docs](https://www.sii.cl/factura_electronica/inscripcion_facturador_electronico.htm).
- [ ] Certificado digital `.pfx` del emisor de prueba subido a Bsale via su panel admin (Bsale internamente lo usa para firmar — no lo manejamos directo).
- [ ] RUT receptor de prueba — cualquier RUT válido (Bsale solo valida formato, no presencia en SII).
- [ ] Acceso shell a una máquina con `pnpm` + `node 22` (Mac de Felipe o sandbox seguro).

## Procedimiento

### 1. Setear env vars en la máquina (NO en el repo)

```bash
# En tu shell local — NO commitear
export BSALE_API_TOKEN="<token-sandbox-bsale>"
export BSALE_TEST_RUT_EMISOR="76123456-7"        # RUT inscrito SII certification
export BSALE_TEST_RUT_RECEPTOR="12345678-9"      # RUT cualquier (solo formato)
export BSALE_TEST_RUN_INTEGRATION=true
```

### 2. Checkout del branch del PR #29

```bash
cd ~/path/to/booster-ai
git fetch origin
git checkout feat/dte-provider-bsale-adapter
pnpm install
```

### 3. Correr el test de integración

```bash
pnpm --filter @booster-ai/dte-provider test bsale.integration
```

**Tiempo esperado**: 10-30 segundos (Bsale + SII pueden tardar).

**Output esperado** (si todo OK):

```
✓ BsaleAdapter — integration test (sandbox SII) > emitGuiaDespacho contra sandbox real → folio asignado por SII

 Test Files  1 passed (1)
      Tests  1 passed (1)
```

**Output esperado** (si las env vars no están):

```
↓ BsaleAdapter — integration test (sandbox SII) [skipped]

 Test Files  1 passed (1)
      Tests  1 skipped (1)
```

### 4. Verificar el DTE emitido

El test emite un folio real en sandbox SII. Para verificarlo:

1. Login al panel Bsale → Documentos.
2. Filtrar por fecha de hoy + tipo "Guía de Despacho".
3. Confirmar que aparece el documento con la `referenciaExterna` `BOO-INT-<timestamp>`.
4. Status esperado: `accepted` o `pending_sii_validation` (puede tomar minutos).

### 5. Si el test FALLA

Posibles causas:

| Síntoma | Causa probable | Fix |
|---------|----------------|-----|
| `DteValidationError: 400` | Field mapping cambió en API Bsale | Revisar `packages/dte-provider/src/bsale.ts` `emitGuiaDespacho` body — comparar con [docs Bsale actuales](https://api.bsale.dev/?bash#documentos) |
| `DteCertificateError: 401` | API token inválido o cert digital vencido | Regenerar token en panel Bsale; verificar cert no vencido en SII |
| `DteRejectedBySiiError: 422` | RUT emisor no inscrito SII certification | Inscribir vía SII o usar otro RUT de prueba |
| `DteProviderUnavailableError: 503` | Bsale o SII certification con downtime | Reintentar más tarde; consultar [status Bsale](https://status.bsale.io/) |
| Timeout 30s | Latencia anormal SII | Aumentar timeout en el test si recurrente |
| `DteFolioConflictError: 409` | RUT sin folios disponibles en SII | Solicitar nuevos folios via panel SII |

Si el field mapping cambió, ajustar `bsale.ts` + commit + re-test. **NO mergear** el PR #29 hasta que el test pase.

## Validación de queryStatus

El test corre 5s después del emit + ejecuta `queryStatus`. Verifica que:

1. El folio retornado coincide con el del emit.
2. El status está en `[accepted, pending_sii_validation, rejected]`.

`rejected` en sandbox puede ser legítimo (RUT receptor inválido, glosa rara). El test no afirma `accepted` estricto — afirma que el flow completo retorna respuesta válida.

## Promoción a producción

⚠️ **NUNCA correr este test contra producción SII** (https://palena.sii.cl) sin coordinación explícita. Producción emite folios oficiales con valor legal y consume el rango disponible del emisor. El test usa `environment: 'certification'` por default; cambiar a `'production'` requiere:

1. PR dedicado que documenta el switch.
2. Aprobación del PO (Felipe) por escrito en el PR.
3. Cert digital del emisor REAL (no de prueba) cargado a Bsale.
4. Validación post-emit que el folio NO es de testing.

## Referencias

- [packages/dte-provider/src/bsale.ts](../../packages/dte-provider/src/bsale.ts) — implementación
- [packages/dte-provider/test/bsale.integration.test.ts](../../packages/dte-provider/test/bsale.integration.test.ts) — test
- [ADR-007 § "Integración SII DTE"](../adr/007-chile-document-management.md)
- [Bsale API docs](https://api.bsale.dev/)
- [SII Chile — Formato DTE](https://www.sii.cl/factura_electronica/formato_dte.htm)
- [SII Inscripción facturador electrónico](https://www.sii.cl/factura_electronica/inscripcion_facturador_electronico.htm)
