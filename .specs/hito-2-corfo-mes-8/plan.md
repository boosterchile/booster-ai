# Hito mes 8 · CORFO 25IR-305522 (SmartAICargo = Booster AI) — Plan de ejecución (v4)

> **Fuente**: `plan-hito-2-corfo-claude-code.md` (Google Doc `1ij0NuKK0qfEf_YNMeVZQrCsd09zwibtCdAjq6z6OWsE`, Drive dev@boosterchile.com), transcrito 2026-07-06. Decisiones de alcance del PO ya incorporadas (v4).
>
> **Para workers agénticos**: ejecutar con `superpowers:executing-plans` / `superpowers:subagent-driven-development`, tarea por tarea, orden estricto W1→W2→W3→W4→W5→W6. TDD obligatorio en dominio crítico (auth, GLEC, migraciones, matching). CLAUDE.md del repo manda.

**Producto**: Booster AI (`boosterchile/booster-ai`) · **Concepto rector**: "impacta menos, transporta más" · **Sesión**: hoy hasta cierre · **Informe**: mañana.

## Alcance v4 (decisiones del PO)

1. **W1: creación de usuarios operativa** (hoy cerrada por SEC-001 — diagnóstico §1).
2. **W2: IMEI Teltonika configurable por la empresa en su UI** + **W3: 2 sensores (ubicación + temperatura) visibles por envío**.
3. **W4 (nuevo, fundamental): tipologías de flota y configuración de viaje** — tracto, camión rígido, semirremolques (acoplados) y remolques (carros de arrastre) — para que el registro de disponibilidad de carga sea adecuado; el viaje toma como referencia la unidad motriz **como va configurada**, asociada al conductor (que tiene su propia UI); **la medición de huella se inicia cuando el conductor inicia el viaje** definiendo origen y destino; posicionamiento y medición vía **Google Maps para camiones sin Teltonika**.
4. Meta 3 y entrevistas de Meta 4 fuera — solo desviaciones en el informe. Evidencia real citable: 1 usuario piloto con dispositivo activo. **Nada se fabrica.**

## 1. Diagnóstico W1 — usuarios (verificado en main)

Tres candados deliberados (SEC-001 + `.specs/onboarding-flow-redesign/`):

- (a) `POST /signup-request` acumula pero el approve está congelado (`SIGNUP_REQUEST_FLOW_ACTIVATED=false`; spec R6: "nadie las procesa hasta el flip").
- (b) Self-onboarding viejo kill-switched (`EMPRESA_SELF_ONBOARDING_ENABLED=false`, SC3: **nunca se reenciende** — la página `/onboarding` es dead-end).
- (c) Camino nuevo admin-provisioned **shippeado en prod (#428, migración 0047) pero dormido** (`ADMIN_PROVISIONED_ONBOARDING_ENABLED=false`, falta `ONBOARDING_TOKEN_SIGNING_SECRET`, fail-closed).

**UI faltante**: no existe página pública de solicitud ni la consumidora del token (onboarding-admin). **W1 = completar UI + activar con seguridad.**

## 2. Diagnóstico W4 — tipologías y huella (verificado en main)

- **Modelo actual plano e insuficiente**: `vehicleTypeSchema` mezcla en un solo enum unidades motrices (`camion_pesado`), unidades sin motor (`semi_remolque`) y carrocerías (`refrigerado`, `tanque`). Capacidad plana por vehículo; **no existe entidad remolque/semirremolque ni concepto de configuración**; el viaje referencia un único `asignado_a_vehiculo_id`. Imposible expresar "tracto X + semirremolque Y = 45 t GVW / 90 m³".
- **La clase GLEC hoy deriva del vehículo suelto** (`carbon-calculator/glec/factor-carga.ts` mapea el enum → LDV/MDV/HDV) — conceptualmente incorrecto: rígido vs articulado lo define la **configuración**, y de ella dependen los factores de emisión. Corregirlo es dominio crítico GLEC (TDD obligatorio).
- **El fallback sin Teltonika ya está arquitecturado y parcialmente vivo**: ADR-028 (dual-source: Teltonika = dato primario GLEC §4.4 nivel 1; sin Teltonika = Google Routes API con `vehicleInfo` + `FUEL_CONSUMPTION`, nivel 2 modelado, con `precision_method` de ADR-022 y degradación de certificado); `posiciones_movil_conductor` recibe GPS del navegador del conductor (`apps/web/src/services/driver-position.ts`) y `/flota` ya la usa como fallback; cron de retención 30d spec'd. **No es greenfield: es cablear el inicio-de-viaje a lo existente.**
- **Conductor**: dashboard propio existe (`conductor.tsx`, "próximo servicio asignado", detalle de asignación). Falta verificar/cerrar la acción explícita **"iniciar viaje"** (transición asignado→en_proceso — el trigger no aparece en las rutas inspeccionadas) con captura de origen/destino, que es el ancla de la medición.
- **Branding**: "impacta menos, transporta más" **no está** en `docs/copy-guide.md` — incorporarlo como claim central.

## 3. Plan de ejecución (orden estricto)

Bajo el CLAUDE.md del repo (superpowers + booster-skills, `.specs/<slug>/`, TDD en dominio crítico — auth, GLEC, migraciones y matching lo son —, evidencia obligatoria, rama + PR, nunca push a main). **Cambios de schema BD y contratos → confirmar con el PO antes** (regla del repo).

### W0 — Preparación (30 min)

- [ ] `git pull` main · `/plugin list` · `.specs/hito-2-corfo-mes-8/` desde este documento · ramas por workstream · `docs/corfo/hito-2/{evidencia,anexos}/`.
- [ ] Node 24 activo (pin `.nvmrc`; usar `/opt/homebrew/opt/node@24/bin` — node 25/26 rompe apps/web con jsdom).

### W1 — Alta de usuarios operativa E2E (3–4 h) · P0 · TDD · rama `feat/onboarding-usuarios-operativo`

1. [ ] **Auditoría cierre Fase 1** (`.specs/onboarding-flow-redesign/plan.md` T1.1–T1.8 vs main post-#428): consumo atómico (`WHERE consumido_en IS NULL`), TTL inyectado (OQ1), camino Google en `/me` (T1.8), reaper agendado en scheduler (no solo el job).
2. [ ] **UI pública `solicitar-acceso`** → `POST /api/v1/signup-request` (202 siempre neutro — respetar anti-enumeración). Enlazar desde login. *(Cortable #4 → mañana AM.)*
3. [ ] **UI `onboarding-admin`** que consume `?token=` contra `/empresas/onboarding-admin`, reutilizando `OnboardingForm`; estados inválido/expirado/consumido (409); clasificación boundary (ADR-057 SC-G1b o el CI falla).
4. [ ] **Dashboard admin**: link de onboarding copiable al aprobar (email real = Fase 2, fuera de hoy → desviación 8).
5. [ ] **Activación (pasos del PO, el agente prepara, NO ejecuta solo)**: secret `ONBOARDING_TOKEN_SIGNING_SECRET` en GSM con valor real ANTES de montar (lección INC-2026-06-19 + preflight `check-validated-secret-placeholders.mjs`) → flip `ADMIN_PROVISIONED_ONBOARDING_ENABLED=true` + `SIGNUP_REQUEST_FLOW_ACTIVATED=true` (`EMPRESA_SELF_ONBOARDING_ENABLED` queda false, SC3) → deploy con gate humano.

**Aceptación W1**: solicitud → approve → Firebase user → token consumido → empresa + rol dueno → login → `/me` sin `needs_onboarding`; segundo consumo 409; path viejo sigue 403; `pnpm ci` verde.

### W2 — IMEI self-service en UI de la empresa (3–4 h) · P0 · TDD · rama `feat/vehiculo-imei-self-service`

Estado: write path solo vía `/admin/dispositivos-pendientes` (open enrollment reactivo); UI solo lectura; `teltonika_imei` UNIQUE; `teltonika_imei_espejo` mutuamente excluyente; `persist.ts` ya resuelve por IMEI.

- [ ] **API** `PATCH /vehiculos/:id/dispositivo` `{teltonika_imei: string|null}`: Zod `^\d{15}$`; tenant/RBAC dueno|admin (patrón `admin-dispositivos.ts`, checklist IDOR); UNIQUE→409 `imei_en_uso` (sin revelar tenant); espejo activo→422 `imei_espejo_activo` (default: rechazar); reconciliación `pending_devices` (aprobar al asociar; reemplazado al cambiar); log estructurado.
- [ ] **UI**: campo editable en detalle de `vehiculos.tsx`.

**Aceptación W2**: IMEI configurado en UI → simulador transmite → `telemetria_puntos` → vehiculo-live, sin panel admin; A no escribe en vehículo de B; 409/422/400 testeados.

### W3 — Temperatura simulada E2E (2.5–3 h) · P0 · rama `feat/telemetria-temperatura-envio`

Pipeline ya soporta IO genérico (`codec8-parser`; `telemetria_puntos.io_data` jsonb).

- [ ] Simulador `scripts/demo/simulate-envio-telemetry.ts` (reusar encoder de load-test): GPS ruta La Serena↔Coquimbo + IO Dallas Temperature FMC150 (décimas °C, perfil frío 2–8 °C con pico); IMEI parametrizable — **usar uno de W2 con usuario de W1** (una cadena demuestra W1+W2+W3).
- [ ] API: `temperaturaC` tipado en endpoint de vehiculo-live.
- [ ] UI: temperatura + timestamp junto a la posición; "sin dato" explícito.

**Evidencia**: screenshot + query a `io_data`.

### W4 — Tipologías de flota, configuración de viaje y huella desde el inicio (staged) · P0 · rama `feat/tipologias-flota-y-huella-inicio-viaje`

#### W4a — Modelo de dominio + ADR + migración (3–4 h, hoy) · TDD (migración = dominio crítico)

Taxonomía semilla (validar contra normativa chilena MTT/D.S. 158 pesos y dimensiones, y clases GLEC v3.0 — brainstorm superpowers con esta base, no desde cero):

- **Unidad motriz** (motor, patente, puede portar Teltonika): `tracto_camion` (no carga por sí solo; arrastra semirremolque por quinta rueda), `camion_rigido` (carrocería propia; puede arrastrar remolque), y los livianos existentes (camioneta, furgón).
- **Unidad de arrastre** (sin motor, patente propia, capacidad propia): `semirremolque` (al tracto — "acoplado"), `remolque` (carro de arrastre, al rígido).
- **Carrocería** como atributo ortogonal de la unidad que porta carga: plano/rampla, cortina (sider), furgón cerrado, refrigerado, tolva, cisterna, portacontenedor, cama baja, jaula, forestal. (Los actuales `refrigerado`/`tanque` migran de "tipo" a carrocería; `semi_remolque` migra a unidad de arrastre.)
- **Configuración de viaje** = 1 unidad motriz + 0..N de arrastre (Chile típico 0..1; bitrén con permiso especial → validar N≤2 con flag). Reglas de compatibilidad: tracto↔semirremolque, rígido↔remolque. **Capacidad efectiva = agregación** (kg, m³, pallets) con techo GVW normativo referencial. **Clase GLEC derivada de la configuración** (rígido vs articulado + GVW combinado), no del vehículo suelto.
- **Decisión de diseño (primera pregunta al PO)**: *Opción A (recomendada)*: generalizar `vehiculos` con `categoria_unidad` ∈ {motriz, arrastre} + campos de carrocería/enganche, y `viajes.unidad_arrastre_id` (FK a vehiculos, nullable) — mínima cirugía, reusa CRUD/UI/IMEI (un semirremolque con asset-tracker cabe gratis). *Opción B*: tabla `unidades_arrastre` separada — más pura, más superficie (CRUD, UI, permisos duplicados). Migración expand/contract con los guards del repo (ADR-043/044); mapping de datos existentes explícito.
- [ ] ADR nuevo documentando taxonomía, compatibilidades y derivación GLEC.
- [ ] Ajustar carbon-calculator (`factor-carga.ts`, `defaults-por-tipo.ts`) para clase-por-configuración — **TDD obligatorio** (dominio GLEC).

#### W4b — Registro de flota en UI (1.5–2 h, hoy si alcanza)

- [ ] Alta/edición de unidades de arrastre y carrocerías en `vehiculos.tsx`/`flota.tsx`; la disponibilidad de carga de la empresa refleja configuraciones posibles (motriz × arrastres compatibles).

#### W4c — Inicio de viaje por el conductor = ancla de la huella (2–3 h, hoy) · corazón CORFO

1. [ ] Localizar/cerrar el trigger de asignado→en_proceso (no aparece en rutas inspeccionadas): acción **"Iniciar viaje"** en la UI del conductor (detalle de asignación), que registra timestamp de inicio, **origen y destino confirmados/definidos por el conductor**, y la **configuración efectiva** (motriz de referencia + arrastre acoplado, editable al iniciar).
2. [ ] Desde ese instante corre la ventana de medición: **con Teltonika** → telemetría real (nivel primario GLEC, ADR-028); **sin Teltonika** → `driver-position.ts` (ya emite GPS del teléfono a `posiciones_movil_conductor`) + Google Routes API `computeRoutes` con `vehicleInfo`/`FUEL_CONSUMPTION` (nivel secundario modelado, ADR-028/022 con `precision_method` y degradación de certificado ya definidos). El cierre del viaje (entregado) cierra la ventana y dispara el cálculo por viaje.
3. [ ] Copy del flujo alineado al claim **"impacta menos, transporta más"**; agregarlo a `docs/copy-guide.md` como claim central.

**Aceptación W4**: viaje iniciado por conductor sin Teltonika → posiciones móviles fluyen → huella calculada al cierre con `precision_method`=modelado y clase GLEC de la configuración; mismo flujo con Teltonika → nivel primario; capacidad agregada visible en el registro de flota.

**Corte honesto**: si el día no da, hoy cierran W4a (ADR+migración+cálculo por configuración) y W4c (inicio de viaje + fallback Maps); W4b completo pasa a primera hora de mañana. W4 alimenta directamente el resultado CORFO "informes de huella de carbono por viaje y cliente" (MSC-ESG).

### W5 — Evidencia Meta 1 (1 h) · P0

- [ ] Matriz en `docs/corfo/hito-2/evidencia/meta-1-crud-auth.md`: Cargas → `offers.ts`/`trip-requests-v2.ts`; Envíos → `assignments.ts` + trip-state-machine; **Usuarios → trace real del alta W1**; Auth/roles → RUT+clave 200/403 (ADR-028/035). `pnpm ci` fresco; cuantificar.

### W6 — Informe de hito (1.5 h) · P0

- [ ] `docs/corfo/hito-2/informe-hito-2.md`:
  1. Resumen con el concepto **"impacta menos, transporta más"** como hilo conductor + equivalencia SmartAICargo↔Booster AI (MCIC-IA→matching/pricing; MVST-IoT/BC→telemetría dual-source Teltonika/Maps + trazabilidad documental; MSC-ESG→carbon-calculator GLEC v3 con huella por viaje anclada al inicio del conductor; MGCR→chat SSE + driver-scoring).
  2. Cumplimiento por meta con evidencia (M1 incl. reapertura segura de altas; M2 redefinida: IMEI self-service + 2 sensores + 1 dispositivo real activo del piloto + fallback Maps para flota sin dispositivo).
  3. Resultados parciales de la carta.
  4. Desviaciones (§4).
  5. Modelo de negocios referenciado a ADRs.
  6. Plan mes 9–24 (roadmap + medicion-huella-segmento + W4b/fases pendientes).

### W7 — Empaquetado (30 min) · P1

- [ ] DOCX/PDF, tag `hito-2-corfo-mes-8`, PRs con `## Evidencia`, checklist indicador→resultado→anexo.

## 4. Desviaciones a declarar

| # | Desviación | Plan correctivo |
|:-:|---|---|
| 1 | Marca SmartAICargo → Booster AI | Tabla de equivalencia; consultar formalización con ejecutivo CORFO |
| 2 | Reescritura greenfield del prototipo localStorage | Ejecutada; positiva (producción GCP). Explicar meses 1–4 |
| 3 | M3: ciclo formal ≥5 usuarios no ejecutado | Evidencia real: 1 piloto con dispositivo activo. Ciclo formal mes 9 (desbloqueado por W1) |
| 4 | M4: 3 entrevistas pendientes; modelo disperso en ADRs | Entrevistas + documento consolidado mes 9 |
| 5 | Blockchain simulado → trazabilidad DTE/SII + Retention Lock | ADR antes del mes 10: Hyperledger o modificación formal |
| 6 | Apps nativas → PWA multi-rol (ADR-008) | TWA/Capacitor antes del mes 18, o modificación de indicador |
| 7 | Gemini directa → Vertex AI ADC (ADR-037) | Solo declarar |
| 8 | Link de onboarding manual (email = Fase 2) | Swap `EmailSignupRequestNotifier` mes 9 |

## 5. Cortes (lo último cae primero)

1. PDF/DOCX pulido → md.
2. Temperatura en asignacion-detalle → basta vehiculo-live.
3. W4b UI completa de arrastres → mañana AM.
4. Página pública W1.2 → mañana AM (admin puede crear solicitudes).
5. Merge de PRs → rama + evidencia fresca.

**No cortables**: W1 E2E (flip aprobado por PO), W2 E2E, W3 screenshot, W4a+W4c, matriz M1, informe honesto.

## 6. Reglas de sesión (del PO, prompt inicial)

- CLAUDE.md del repo manda. Commit+push al cerrar cada tarea.
- Schema BD, contratos públicos y acciones sobre producción (secret, flags, deploy): **siempre con aprobación explícita previa del PO**.
- Si espejo IMEI, reconciliación de `pending_devices`, la Opción A/B de W4a o el gate de activación admiten otra interpretación con impacto → **preguntar antes**.
- W5/W6: no inventar usuarios, pruebas ni entrevistas. Única evidencia de pilotos: 1 usuario con 1 dispositivo activo (respaldar con `telemetria_puntos`).

---

*Verificado contra `boosterchile/booster-ai@main` (2026-07-06) por el autor del plan: flags en `config.ts` L521–556 y gates de `admin-signup-requests.ts`; `.specs/onboarding-flow-redesign/` (SC3/SC8/R6, review P0–P2); ausencia de UI pública/consumidora en `router.tsx`; `vehiculos.ts` L24 + schema (IMEI admin-only, UNIQUE, espejo); `domain/vehicle.ts` (enum plano, sin arrastres ni configuración); `viajes.asignado_a_vehiculo_id` único; `carbon-calculator/glec/factor-carga.ts` (clase por vehículo suelto); ADR-028 dual-source + ADR-022 `precision_method`; `driver-position.ts` + `posiciones_movil_conductor` + spec retención; `conductor.tsx` (dashboard sin trigger visible de en_proceso); `copy-guide.md` sin el claim; handoff `CURRENT.md`.*
