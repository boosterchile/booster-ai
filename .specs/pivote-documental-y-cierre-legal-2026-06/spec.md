# pivote-documental-y-cierre-legal-2026-06 — Execution Plan

**Generado por**: skill `arquitecto-maestro` v1.1.0
**Fecha**: 2026-06-17
**Status**: **Draft — pendiente aprobación PO** (no ejecutar Fase Act sin firma en §13)
**PO**: Felipe Vicencio — dev@boosterchile.com

> Este documento es el **plan**, no el código. Diseña la descomposición, secuencia y ADRs de un programa de 4 frentes. Cada frente se ejecuta en su propio `.specs/<sub-slug>/` con TDD y PR independiente, **después** de aprobado este plan.

---

## 1. Objective

Cerrar el frente legal pendiente de la auditoría 2026-06-14 y ejecutar el **pivote del modelo documental** de Booster: dejar de **emitir** DTE (remover Sovos) y pasar a **recibir y archivar** los documentos tributarios de terceros (Guía de Despacho DTE 52 / Factura 33) que amparan cada orden de transporte, con extracción "best-effort" del TED.

Comportamiento observable al cierre del programa completo:

- **F1 (consent)**: un usuario solo puede otorgar grants ESG sobre empresas/portafolios donde es `dueno`/`admin`; cualquier intento cross-empresa devuelve `403`. El modelo de consentimiento (19.628 + 21.719) está versionado en el repo y referenciado por el flujo de otorgamiento.
- **F2 (PII)**: `OLD_DEMO_UIDS` ya no está en el código vivo; queda en Secret Manager/env, con decisión de historial documentada.
- **F3 (remover Sovos)**: `DTE_PROVIDER`, `SOVOS_*`, el adapter Sovos, el cron de reconciliación y el endpoint de emisión ya no existen ni se ejecutan; ADR-024 superseded; ADR-007 modificado.
- **F4 (repositorio documental)**: el generador o el transportista sube el PDF/foto de la guía/factura a una orden, un worker la decodifica (TED/PDF417) best-effort, y la orden se puede **cerrar con al menos un documento subido**, decodificado o no.

## 2. Why now

- **Legal desbloqueado**: el modelo de consentimiento conforme Ley 19.628 + Ley 21.719 (vigente 01-dic-2026) ya existe (`Modelo_Consentimiento_ESG_Booster.docx`, `Aviso_Privacidad_Corto_Booster.md`). Era el único bloqueo de P0-B/P1-B. La 21.719 entra en vigencia en ~5.5 meses; el flujo de consentimiento debe ser conforme antes de esa fecha.
- **Pivote de negocio**: Booster NO será emisor de DTE en esta fase. Mantener la integración Sovos (ADR-024) es deuda activa (código, cron horario, secretos, columnas) que ya no sirve al producto y arrastra el bloqueante legal P0-A (retention lock).
- **P0-A se resuelve solo**: el gate del retention-lock era "(a) emisión real de DTE en prod". Sin emisión, el gate nunca se cumple → P0-A pasa a **"no aplica"**. El spec `sec-h3-dte-retention-lock` queda obsoleto.
- **Cierre de la auditoría**: estos frentes agotan los 🔒 legales (P0-A/B/C) + P1-B, que eran el grueso de lo que quedaba bloqueado.

## 3. Success criteria (measurable)

**Programa:**
- [ ] Los 4 frentes mergeados a `main` vía PR + squash, cada uno con su sección `## Evidencia`.
- [ ] `pnpm ci` verde (lint 0, typecheck 0, coverage ≥80% en código nuevo, build OK) en cada PR.
- [ ] 3 ADRs nuevos (068, 069, 070) mergeados; ADR-024 marcado superseded; ADR-007 modificado vía el ADR nuevo.

**F1 — consent:**
- [ ] Test de integración IDOR: `dueno` de empresa A recibe `403 forbidden_scope_authority` al otorgar sobre empresa B (scopes `organizacion`/`generador_carga`/`transportista`) y sobre `portafolio_viajes` con trips ajenos.
- [ ] `me-consents.ts` valida `memberships.empresaId === scopeId` (P1-B) y, para `portafolio_viajes`, que todos los trips pertenezcan a empresas del otorgante (P0-B).
- [ ] Modelo de consentimiento versionado en `docs/legal/` + ADR-068 que lo vincula al schema `consents`.

**F2 — PII:**
- [ ] `grep -n OLD_DEMO_UIDS apps/api/src` no devuelve literales de UID (vienen de env/Secret Manager).
- [ ] `harden-demo-accounts.ts` lee los UIDs de configuración validada (Zod) en vez de constante hardcoded.
- [ ] Documento de decisión (no reescribir historial) + confirmación equipo de que son demo + rotación/invalidación registrada.

**F3 — remover Sovos:**
- [ ] Reporte de remoción (`report.md`) lista los 32 puntos con ruta:línea y clasificación activo/scaffolding.
- [ ] `grep -riE 'sovos|DTE_PROVIDER' apps packages infrastructure` solo devuelve historia (ADR), no código vivo.
- [ ] Cron `reconciliar-dtes` eliminado de `scheduling.tf`; endpoint `/admin/liquidaciones/:id/emitir-dte` eliminado; columnas `dte_*` **deprecadas** (dejan de escribirse), no DROP, salvo confirmación explícita.

**F4 — repositorio documental:**
- [ ] Tabla `documentos_transporte` (FK a `viajes`) migrada; schema Zod de dominio en `shared-schemas`.
- [ ] 4 endpoints Hono operativos con Zod en boundaries; upload persiste fila `pending` y publica `document.uploaded`.
- [ ] Worker Cloud Run decodifica un PDF de guía de ejemplo → `decoded` con campos del `<DD>`; una foto mala → `failed` → habilita manual; DLQ tras N intentos.
- [ ] Orden cerrable con ≥1 documento subido aunque el TED no decodifique (`REQUIRE_TED_DECODE=false`).
- [ ] Tags del TED validados contra `formato_dte_202602.pdf` del SII antes de fijar el parser.

## 4. User-visible behaviour

| Actor | Antes | Después |
|---|---|---|
| Otorgante de consent ESG | Puede crear grants sobre cualquier empresa si es dueño/admin de *alguna* | Solo sobre empresas/portafolios propios; resto `403` |
| Admin plataforma | Endpoint para re-emitir DTE Tipo 33 | Endpoint eliminado (Booster ya no emite) |
| Generador / Transportista | No hay forma de adjuntar la guía/factura que ampara la carga | Sube PDF/foto a la orden; ve estado de extracción (pending→decoded/failed) vía `GET /documents/:id` + canal SSE |
| Cierre de orden | (definido por estado de viaje actual) | Requiere ≥1 documento subido; el TED es enriquecimiento, no bloqueo |
| Operador GCP | Cron horario `reconciliar-dtes` corriendo | Cron eliminado |

## 5. Out of scope

- **Espejo Firestore** (decisión PO 2026-06-17): Postgres es la única fuente; estado realtime vía polling `GET /documents/:id` + canal SSE existente. Firestore queda como mejora futura opcional, no dependencia.
- **Reescritura del historial git** (decisión PO 2026-06-17): no se hace `filter-repo` en este programa. Si los UIDs resultaran ser secretos reales, se trata como incidente separado con ventana planificada.
- **Conexión real al canal XML de Intercambio SII** (Tarea 6): solo interfaz + stub `XmlIntercambioIngestor`, sin conexión.
- **Emisión de DTE de cualquier tipo**: Booster no emite. No se integra con facturación electrónica SII en esta fase.
- **DROP de tablas/columnas con datos** (`facturas_booster_clp`, columnas `dte_*`, BigQuery): deprecación (marcar y dejar de escribir), nunca DROP sin confirmación explícita del PO.
- **Completar los campos `[ ]` del modelo legal y el sign-off de abogado habilitado**: es responsabilidad del PO/legal; el plan lo trata como dependencia externa, no como tarea de código.

## 6. Constraints

- **Stack Booster no-negociable** (CLAUDE.md): zero `any`, Zod en boundaries, `@booster-ai/logger` (no `console.*`), OTel + `trace_id` por endpoint, coverage ≥80%, Conventional Commits con scope, sección `## Evidencia` en cada PR.
- **Naming bilingüe**: SQL español snake_case sin tildes → tabla **`documentos_transporte`** (no `transport_documents`); FK a **`viajes`** (no `transport_orders`). Export TS `transportDocuments` / `TransportDocumentRow`.
- **Domain canónico** en `packages/shared-schemas/src/domain/`; toda tabla Drizzle debe coincidir con un schema del domain. DDL Drizzle canónico en `apps/api/src/db/schema.ts`.
- **Algoritmos en packages**: la lógica de decodificación TED (rasterizar, PDF417, parseo `<DD>`) vive en `packages/transport-documents`, no inline en services.
- **TDD obligatorio** (`tdd-dominio-critico`): F1 (auth/consent), F3 (toca facturación/migraciones), F4 (migraciones + parseo de documentos tributarios) son dominio crítico → red-green-refactor.
- **ADRs antes de implementar**, no en retrospectiva. ADR no se edita: se supersede.
- **Secretos**: Secret Manager vía Terraform, nunca en código.
- **Worker WASM-only**: Dockerfile sin binarios de sistema (apt-get). Ver Riesgo R-4 (tensión con `sharp`).
- **Numeración**: ADR 067 reservado por PR #426 abierto → usar **068/069/070**. Migración 0043 reservada por PR #428 abierto → tomar el siguiente libre al ejecutar.

## 7. Approach

Programa de **4 frentes**, ejecutables en buena medida en paralelo salvo la dependencia F3→F4. Cada frente = su propio `.specs/<sub-slug>/{spec,plan,verify}.md` + PR.

### Secuencia recomendada

```
Fase A (paralelo, bajo riesgo, cierra P0 legales):
  F1  consent IDOR + modelo legal       → .specs/consent-idor-y-modelo-19628-21719/
  F2  PII UIDs demo                      → .specs/p0c-uids-demo-secret-manager/

Fase B (pivote, F3 antes que F4):
  F3  remover Sovos/DTE (reporte→ADR→remoción)  → .specs/remover-emision-dte-sovos/
       └─ ADR-069 supersede ADR-024, modifica ADR-007
  F4  repositorio documental (sub-fases 4a→4b→4c) → .specs/repositorio-documental-transporte/
       └─ ADR-070 (modelo recepción/archivo de DTE de terceros)
```

### F1 — Consent IDOR + modelo legal (cierra P0-B + P1-B)

1. **Documentar el modelo legal**: copiar `Modelo_Consentimiento_ESG_Booster` + `Aviso_Privacidad_Corto` a `docs/legal/` (versionados, con marca de "campos `[ ]` y sign-off abogado pendientes — dependencia externa").
2. **ADR-068**: modelo de consentimiento ESG conforme 19.628 + 21.719; cómo se mapea al schema `consents` (versión del documento, finalidades como `dataCategories`, evidencia: identidad/fecha/versión/IP). Complementa ADR-028/ADR-034.
3. **Fix IDOR (TDD-first)** en `apps/api/src/routes/me-consents.ts`:
   - **P1-B (líneas 98-106)**: `WHERE userId = ? AND empresaId = scopeId AND status='activa' AND role IN ('dueno','admin')`.
   - **P0-B (líneas 85-95)**: `portafolio_viajes` valida que todos los trips del `scope_id` pertenezcan a empresas donde el user es dueño/admin (join `viajes`→`empresas`→`memberships`).
   - Índice compuesto si la auditoría de scope lo requiere.
4. **Gap modelo↔schema** (a evaluar en el spec de F1): el modelo legal exige registrar versión del aviso + IP/dispositivo + finalidades-como-casillas; `consents` hoy guarda `consentDocumentUrl` pero no versión/IP. Posible columna nueva → migración menor. **Open question O-1.**
5. **Flujo de captura en signup** (casillas sin premarcar, granular, evidencia) — la 21.719 prohíbe premarcadas/tácito. **Puede ser sub-fase F1b** (frontend `apps/web` + backend evidencia). Dimensionar en el spec.
6. Subagents de revisión: `booster-skills:security-scanner` (módulo compliance: Ley 19.628, consent ESG, RBAC) sobre el diff.

### F2 — PII UIDs demo (cierra P0-C)

1. **Confirmar con el equipo** (instrucción PO) si los 4 UIDs (`harden-demo-accounts.ts:34-37`) son de cuentas demo o reales.
2. Mover `OLD_DEMO_UIDS` a env var validada por Zod en `config.ts` (o Secret Manager si se considera sensible) → fuera del código vivo y de futuros commits.
3. Si son demo: **rotar/invalidar** esos identificadores en el sistema (Firebase) y documentar el hallazgo; **no** reescribir historial.
4. Si fueran reales: escalar como incidente separado + ventana planificada (fuera de este programa).
5. Documento de decisión en `.specs/p0c-uids-demo-secret-manager/` + nota en/junto a ADR-053.

### F3 — Remover Sovos/DTE (cierra P0-A, supersede ADR-024)

Branch propio. **Reporte primero** (lo pide el brief y arquitecto-maestro).

1. **`report.md`**: formalizar el inventario de 32 puntos ya mapeados (packages/SDK, clientes, env/secretos, endpoints, Pub/Sub, tablas/migraciones, jobs, buckets) con ruta:línea y clasificación activo/scaffolding.
2. **ADR-069**: "Booster deja de emitir DTE; remoción Sovos". Supersede ADR-024; modifica ADR-007 §emisión (Booster pasa de **emisor** a **receptor/archivador** de DTE de terceros). Declara P0-A como "no aplica" y obsoleto `sec-h3-dte-retention-lock`.
3. **Remoción reversible** (branch aislado; flag si conviene): borrar/archivar `packages/dte-provider`, adapter Sovos, factory, services `emitir-dte-liquidacion`/`reconciliar-dtes`, endpoint admin, env `DTE_PROVIDER`/`SOVOS_*`, cron `scheduling.tf:154-188`, tests asociados.
4. **Datos**: columnas `dte_*` en `facturas_booster_clp` y la tabla → **deprecar** (dejar de escribir, comentar como legacy), no DROP. **Open question O-2**: ¿`facturas_booster_clp` (facturación de comisiones de Booster) sobrevive como registro interno sin emisión? El reporte lo clarifica.
5. **Bucket `documents`** (retention 6a, `is_locked=false`): decidir si se reutiliza para los documentos de terceros del F4 o se separa. Ligado a O-3 (retención legal de docs de terceros).
6. Subagent `booster-skills:sre-oncall` pre-merge (toca infra: cron, posiblemente bucket).

### F4 — Repositorio documental por orden (Tareas 2-6)

Hosting (decisión PO): lógica de dominio en **`packages/transport-documents`**, endpoints montados en **`apps/api`**, worker de extracción TED como **servicio Cloud Run separado** suscrito a `document.uploaded`. Propuesta: construir el worker sobre **`apps/document-service`** (skeleton existente que ADR-007 designó documental; elimina esa deuda) en vez de una app nueva — **Open question O-4**.

Sub-fases:

- **4a — Datos + API (apps/api, TDD)**:
  - Migración `documentos_transporte` (FK `viajes.id`): `id uuid`, `viaje_id`, `file_path`, `file_mime`, `doc_type` enum(`33,34,52,56,61,other`), `folio` (nullable), `rut_emisor`, `razon_social_emisor`, `rut_receptor`, `razon_social_receptor`, `fecha_emision date`, `monto_total numeric`, `ted_raw text`, `ted_signature_valid bool nullable`, `extraction_status` enum(`pending,processing,decoded,manual_entry,failed`), `source` enum(`pdf_upload,photo_upload,xml_intercambio`), `uploaded_by`, `creado_en`, `actualizado_en`.
  - Schema Zod de dominio en `shared-schemas/src/domain/`.
  - Endpoints (Zod en boundaries, auth existente, multipart vía `c.req.formData()` patrón `site-settings.ts`, GCS signed URL patrón `certificate-generator/storage.ts`):
    - `POST /transport-orders/:id/documents` → persiste `pending`, publica `document.uploaded`, `202`.
    - `POST /documents/:id/manual-entry` → corrige campos, `extraction_status=manual_entry`.
    - `GET /transport-orders/:id/documents` → lista.
    - `GET /documents/:id` → detalle + signed URL.
- **4b — Worker TED (Cloud Run, `apps/document-service`)**:
  - Consumer Pub/Sub patrón `telemetry-processor` (Zod + ack/nack + DLQ tras N intentos).
  - PDF → rasterizar con `@hyzyla/pdfium` (WASM); imagen → preprocesar (ver R-4 sobre `sharp`); decodificar PDF417 con `zxing-wasm`; parsear XML del TED con `fast-xml-parser` mapeando `<DD>`: RE→rut_emisor, TD→doc_type, F→folio, FE→fecha_emision, RR→rut_receptor, RSR→razon_social_receptor, MNT→monto_total.
  - **Validar tags contra `formato_dte_202602.pdf` del SII** (https://www.sii.cl/factura_electronica/factura_mercado/formato_dte_202602.pdf) **antes** de fijar el parser.
  - Flag `VALIDATE_TED_SIGNATURE`: firma `<FRMT>` (SHA1withRSA) con pública del `<CAF>` (node:crypto).
  - Persistir `decoded`/`failed`; lógica en `packages/transport-documents` (interface `DocumentIngestor` + `PdfTedIngestor`).
  - Dockerfile WASM-only.
- **4c — Cierre flexible + stub XML**:
  - Regla (TDD, toca `trip-state-machine`): orden cerrable con ≥1 documento subido; `REQUIRE_TED_DECODE=false` por defecto.
  - `XmlIntercambioIngestor` stub (interface + no-op), sin conexión SII.
- Infra: topic `document.uploaded` + subscription + DLQ (`messaging.tf`), bucket de subida, SA del worker, `adding-cloud-run-service` si el worker es app nueva.
- Subagents: `dependency-auditor` (deps WASM nuevas), `security-scanner` (upload, signed URLs, PII en docs de terceros), `sre-oncall` (worker + DLQ + Cloud Run).

## 8. Risks

| ID | Riesgo | L | I | Mitigación |
|---|---|---|---|---|
| R-1 | Fix IDOR rompe otorgamientos legítimos (regresión auth) | M | H | TDD-first con matriz quién-puede-otorgar-sobre-qué; security-scanner; tests de integración antes del merge |
| R-2 | Remoción Sovos deja referencias colgantes (imports rotos, cron al vacío) | M | M | Reporte exhaustivo previo; `grep` de verificación en success criteria; branch aislado + `pnpm ci` |
| R-3 | DROP accidental de datos en deprecación de tablas DTE | L | H | Política explícita: deprecar (no escribir), nunca DROP sin confirmación; guard CI de migration-safety ya existe |
| R-4 | `sharp` no es WASM (usa libvips nativo) — choca con "Dockerfile sin binarios" | H | M | **O-5**: aceptar binarios prebuilt npm de sharp, o reemplazar por preprocesamiento WASM (photon/jsquash), o omitir preprocesamiento (zxing tolera imágenes) |
| R-5 | Tags TED mal mapeados → metadatos incorrectos en documentos legales | M | H | Validar contra PDF oficial SII antes de fijar parser; test con guía real decodificable |
| R-6 | El modelo legal es plantilla (campos `[ ]`, sin sign-off abogado) → documentar algo no-final | M | M | Versionar con marca "borrador legal, pendiente completar + sign-off"; el fix de código es independiente del texto |
| R-7 | Worker como app nueva dispara proceso de 11 pasos (adding-cloud-run-service) | M | M | Reutilizar `apps/document-service` (skeleton) en vez de app nueva (O-4) |
| R-8 | Retención de docs de terceros mal definida (¿6 años? ¿ninguna?) | M | M | O-3: decisión legal; default propuesto = conservar mientras dure relación, sin lock (Booster no es contribuyente emisor) |

## 9. Alternatives considered (rejected)

- **Espejo Firestore ahora**: rechazado por PO — primer uso de Firestore en backend, superficie de riesgo dentro de feature crítica. Polling + SSE existentes bastan.
- **Reescribir historial git para P0-C**: rechazado por PO — rompe todos los PRs abiertos e invalida clones; costo desproporcionado para UIDs demo ya deshabilitados.
- **Worker TED en apps/api**: rechazado — el procesamiento pesado (rasterizar PDF + PDF417) en el request path del API agota slots de concurrencia Cloud Run; va a servicio separado.
- **DROP de columnas/tablas DTE**: rechazado — pérdida irreversible; se deprecan.
- **Mantener Sovos "por si acaso"**: rechazado — deuda activa (cron, secretos, código) sin uso de producto; YAGNI.

## 10. Test list

- **F1**: IDOR cross-empresa (`organizacion`/`generador_carga`/`transportista`) → 403; `portafolio_viajes` con trips ajenos → 403; happy path dueño de la empresa correcta → 201; revoke ajeno → 403 (no regresión).
- **F2**: `harden-demo-accounts` lee UIDs de config (Zod) y aplica el hardening igual que antes; `config.ts` rechaza arranque si la env es inválida.
- **F3**: tras remoción, `pnpm typecheck` 0 errores (sin imports colgantes); suite API verde sin tests DTE; `grep` de verificación vacío en código vivo.
- **F4**: PDF de guía de ejemplo → `decoded` con campos `<DD>` correctos; foto ilegible → `failed` → manual-entry corrige → `manual_entry`; orden cierra con doc subido y TED no decodificado; payload Pub/Sub malformado → ack-descarta; N fallos → DLQ; firma TED válida/ inválida con flag on.

## 11. Open questions (para el PO / legal)

- **O-1**: ¿Añadimos columnas a `consents` (versión del aviso, IP/dispositivo, finalidades-como-casillas) para cumplir la evidencia que exige el modelo, o basta `consentDocumentUrl`? (afecta migración en F1)
- **O-2**: ¿`facturas_booster_clp` (facturación de comisiones de Booster) sobrevive como registro interno sin emisión DTE, o también se deprecia? (F3)
- **O-3**: Retención legal de los documentos de **terceros** archivados (guías/facturas que amparan carga): ¿aplica plazo SII de 6 años aunque Booster no sea el emisor/contribuyente? Default propuesto: conservar mientras dure la relación, sin retention lock. (F3/F4 + infra)
- **O-4**: Worker TED, ¿sobre `apps/document-service` (reutiliza skeleton, recomendado) o app Cloud Run nueva? (F4)
- **O-5**: Preprocesamiento de imagen: ¿aceptamos `sharp` (binarios prebuilt npm, no WASM puro) o exigimos WASM estricto (photon/jsquash) o lo omitimos? (F4, choca con "Dockerfile sin binarios")
- **O-6 (legal)**: ¿Quién completa los campos `[ ]` del modelo/aviso y da el sign-off de abogado habilitado, y en qué fecha? Es dependencia externa del F1.

## 12. Devils-advocate pass

> Nota: agent-rigor (y su sub-agent `devils-advocate`) fue retirado por ADR-060. Pasada crítica hecha inline por el arquitecto.

- **"¿El fix IDOR necesita el modelo legal para mergearse?"** No técnicamente — el código valida autoridad, no texto. **Pero** el PO condicionó P0-B/P1-B a "revisión legal del modelo de consentimiento". El modelo ya existe (aunque sea borrador). Riesgo: mergear el fix con un modelo aún no firmado por abogado. Mitigación: el fix de control de acceso se mergea (cierra el IDOR real); el versionado del texto se marca "borrador, sign-off pendiente" (O-6). No se bloquean entre sí.
- **"Remover Sovos, ¿no destruye trabajo válido?"** ADR-024 fue una decisión cara (multi-vendor LATAM). Removerla es un pivote real de negocio, declarado por el PO. El adapter pattern se archiva (git history + ADR), no se pierde conocimiento; si Booster vuelve a emitir, se re-evalúa. Reversible vía branch + ADR.
- **"P0-A: ¿de verdad se 'resuelve' o se barre bajo la alfombra?"** Se resuelve por eliminación de la causa: sin emisión de DTE no hay obligación de retention lock del emisor. Pero **O-3** abre un riesgo nuevo: los docs de terceros archivados podrían tener su propia obligación de retención. No es el mismo P0-A, pero el ADR-069 debe declararlo explícitamente para no dejar un hueco de compliance.
- **"4 frentes en un plan, ¿no es demasiado para una sola aprobación?"** Por eso cada frente es PR + spec independiente y la sesión solo entrega el plan. El PO puede aprobar frentes selectivamente (ej. F1+F2 ya, F3+F4 después).
- **"¿El brief usa nombres en inglés; cambiarlos a español no contradice al PO?"** Es contrato no-negociable del repo (CLAUDE.md naming bilingüe). Se documenta el mapeo (`documentos_transporte`/`transportDocuments`) para que no sorprenda. Gana la regla Booster por precedencia.

## 13. Approval

- [ ] **PO aprueba el plan** (chat o comentario sobre este archivo).
- [ ] PO resuelve O-1..O-6 (o delega defaults propuestos).
- [ ] PO indica qué frentes arrancar primero (recomendado: F1 + F2 en paralelo).

**Pendiente de firma — fecha:** ____________
