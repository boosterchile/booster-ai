# ADR-080 — Flujo de dinero bajo mandato de cobro: Booster cobra al generador, libera al transportista contra recepción conforme y financia el desfase con un operador financiero

**Estado**: Vigente (la activación en producción está sujeta a las precondiciones de §6; hasta cumplirlas rige el modo conector de §5)
**Fecha**: 2026-09-09
**Decider**: Felipe Vicencio (Product Owner)
**Supersede a**: [ADR-027](./027-pricing-model-uniform-shipper-set-with-tier-commission-roadmap.md) §3 (Booster facturador y no passthrough; sin retención de fondos del flete; fuera del régimen de casa de pago), regla de flujo que sobrevivía a su supersesión por ADR-030; [ADR-030](./030-pricing-v2-activation-commission-and-billing.md) en su flujo de dinero (el generador paga directo al transportista; Booster factura la comisión al carrier); [ADR-029](./029-factoring-pronto-pago-al-transportista.md) §1, §2 y §4 y [ADR-032](./032-factoring-v1-activacion-escala-minima.md) §1 y §3 (pronto pago por cesión de la factura del transportista a un partner, con tarifa fija 1,5/2,2/3,0/4,5 % sobre el neto post-comisión). **Se conservan** de ADR-029/032: el underwriting del generador y su decisión de crédito vigente, el cupo de exposición revolving por generador con contador transaccional, las tablas `adelantos_carrier` y `shipper_credit_decisions`, la idempotencia por asignación, el flag `FACTORING_V1_ACTIVATED` (default `false`) y el versionado `factoring_methodology_version`.
**No toca**: [ADR-069](./069-booster-deja-de-emitir-dte-remocion-sovos.md) / [ADR-070](./070-repositorio-documental-terceros-retencion-custodia.md): Booster sigue sin emitir DTE; el transportista factura el flete al generador y Booster archiva el documento.
**Related**: [ADR-079](./079-modelo-comercial-v3-comision-al-generador-configurable.md) (base y pagador de la comisión; `configuracion_comercial.financiamiento`), Plan de Flujo de Caja sep-2026 → jun-2027 §2.1, §7, §9.2 y §11 (F. Sandoval), reunión con Blanco Financiero (2026-08-24) y su debrief, catch-up de tarifas y modelo de cobro (2026-08-26), reunión de revisión del plan de negocio (2026-09-07), [ADR-076](./076-gobernanza-operador-unico.md) §3 (evidencia previa para acciones irreversibles).

---

## Contexto

**Lo que rige hoy.** ADR-027 §3 decidió que el flete fluye directo del generador al transportista y que Booster solo factura su comisión, precisamente para no retener dinero ajeno ni entrar al ámbito de la CMF. Sobre esa base, ADR-029/032 diseñaron "Booster Cobra Hoy" como cesión de la factura del transportista a un partner de factoring, con Booster como originador. El módulo está construido (cotización, solicitud, historial, cupo por generador, decisión de crédito) y apagado (`FACTORING_V1_ACTIVATED=false`, decisión PO 2026-06-10).

**Lo que se acordó el 2026-08-26.** La figura legal preferida es el **mandato de cobro**, modelo Mercado Libre: el generador paga a Booster el precio del transportista más la comisión, y Booster libera el pago al transportista al confirmarse la **recepción conforme**. El plan de caja registra tres consecuencias:

1. **Habilita el financiamiento integrado**: el flujo pasa por la plataforma y el anticipo queda vinculado a la evidencia de entrega vía GPS, que es lo que reduce la tasa.
2. **Exige dos cuentas bancarias**: operacional propia y de fondos de terceros, con su carga administrativa.
3. **Genera un requerimiento de capital de trabajo estructural**: pagar al transportista al día 5 y cobrar al generador al día 30 significa financiar 25 días del flete completo, no solo de la comisión. En el peak de febrero de 2027 el flete de terceros en tránsito es de $49,0 / $98,6 / $173,5 MM (Conservador / Base / Optimista) contra una caja propia de −$4,4 / $34,5 / $84,7 MM: brecha de −$53,4 / −$64,1 / −$88,8 MM. **La brecha crece con el éxito comercial.**

**Las tres salidas del plan, en orden de preferencia** (§7): (1) línea de confirming con Booster como mandante y los transportistas adheridos como proveedores (reunión con Blanco Financiero del 24-ago; registro completado, tasas por negociar), que debe estar aprobada y probada **antes del 30 de noviembre de 2026**; (2) doble estructura: línea bancaria de respaldo más factoring no bancario (recomendación recibida en esa reunión); (3) renunciar al mandato de cobro y operar como conector puro: elimina el capital de trabajo pero destruye el financiamiento integrado y agrava la desintermediación. La reunión del 2026-09-07 sumó una conversación con un segundo operador para explorar "factoring con comisión", es decir, la ruta 2.

**Por qué no basta con ADR-029/032.** Su mecánica supone que Booster no toca el flete y que el transportista cede una factura ya emitida. Bajo mandato de cobro, Booster sí recibe el flete, la comisión ya no se descuenta al transportista (ADR-079 §1) y el anticipo lo desembolsa un operador dentro de un programa de confirming donde el deudor es el generador vía Booster mandante. La tabla fija de tarifas de ADR-032 §3 deja de tener sentido cuando la tasa la fija el operador.

## Decisión

### 1. Flujo objetivo: mandato de cobro

- El generador paga a Booster `precio_generador_clp` (precio del transportista + comisión, más el IVA de la comisión) en el plazo `plazo_pago_generador_dias` (inicial 30, configurable en `configuracion_comercial.financiamiento`, ADR-079 §3).
- Booster libera al transportista `precio_transportista_clp` íntegro dentro de `plazo_liberacion_transportista_dias` (inicial 5) contados desde la **recepción conforme**: confirmación del generador en la plataforma con el documento del viaje archivado (ADR-070). Sin recepción conforme no hay liberación.
- Booster retiene su comisión + IVA al liberar. Los fondos del flete viven en una **cuenta de fondos de terceros separada** de la cuenta operacional, con conciliación diaria contra la tabla de pagos.
- El transportista sigue facturando el flete al generador (ADR-069/070); Booster cobra ese documento por mandato y archiva la factura. Booster factura al generador solo su comisión.

### 2. Estados del pago de un viaje

Se modela por viaje, con dos líneas de tiempo independientes que arrancan en la recepción conforme:

- **Cobro al generador**: `pendiente` → `cobrado` (fecha de abono) o `mora` (plazo vencido sin abono; bloquea cupo, ADR-029 §3).
- **Liberación al transportista**: `pendiente` → `liberado_por_booster` (transferencia desde fondos de terceros) o `anticipado_por_operador` (§3).
- Cualquiera de las dos líneas puede quedar en `disputa` (recepción objetada por el generador); una disputa congela la liberación, no el cobro.

La tabla concreta (expansión de `liquidaciones` con `recepcion_conforme_en`, `cobrado_generador_en`, `liberado_transportista_en`, `medio_liberacion`, `modo_flujo` = `conector` | `mandato_cobro`, o una tabla `pagos_viaje` aparte) la fija la spec de implementación bajo el guard expand-only de ADR-066. Lo contractual es: cada evento con marca temporal, ninguna transición sin evidencia asociada, y un gauge de **float de terceros** = Σ(liberado y no cobrado) que se publica como métrica de negocio (`caja.float_terceros_clp`).

### 3. Financiamiento del desfase y pronto pago

- La ruta principal es la **línea de confirming** con Booster como mandante y los transportistas adheridos como proveedores del programa. El operador desembolsa el anticipo al transportista contra `recepción_conforme` + traza GPS del viaje, y cobra al vencimiento con el pago del generador a Booster. Booster recibe una **originación** sobre el monto anticipado (`originacion_pct`, inicial 0,4 %, rango 0,3–0,5 %).
- **La tasa al transportista la fija el operador**, no Booster. La tabla 1,5/2,2/3,0/4,5 % de ADR-032 §3 pasa a ser el valor por defecto configurable para el modo demostración (sin operador) y para cotizar cuando el operador no entrega tasa por API; en ningún caso es un precio de Booster.
- **Base del anticipo**: `precio_transportista_clp` completo (ya no "neto post-comisión": la comisión no se le descuenta al transportista). Anticipo hasta `anticipo_documento_pct` del documento (inicial 90 %, práctica de mercado).
- El módulo Cobra Hoy se **re-escopa**, no se reconstruye: cotización, solicitud, historial, decisión de crédito del generador, cupo revolving y `adelantos_carrier` se conservan; `partner_slug` identifica al operador del programa; la cesión electrónica de DTE (Ley 19.983) pasa de requisito a respaldo opcional según lo exija el operador. `factoring_methodology_version` sube a `factoring-v2.0-cl-2026.09`.
- La doble estructura (ruta 2) es bienvenida y no requiere ADR nuevo: es un segundo `partner_slug` en el mismo programa.

### 4. Riesgo y evidencia

- El riesgo de crédito se ancla en el **generador** (recepción conforme registrada, decisión de crédito vigente, cupo), no en el transportista ni en Booster. Las excepciones con recurso contra el transportista se mantienen (adendum Cobra Hoy §7: fraude, viaje no entregado, disputa válida no resuelta en 30 días).
- Cada peso en tránsito tiene asociado: recepción conforme, traza GPS/CAN, contrato generado en el match y documento SII archivado. Es lo que Booster entrega al operador con cada anticipo y lo que justifica la tasa.

### 5. Modo conector: degradación explícita y estado vigente hoy

- Flag `MANDATO_COBRO_ACTIVATED` (`booleanFlag(false)` en todos los entornos; solo por env var vía Terraform). En `false`, **modo conector**: el generador paga directo al transportista, Booster factura la comisión al generador aparte (ADR-079 §1 aplica igual) y no hay anticipo integrado ni fondos de terceros. Es el modo en que la plataforma opera hoy y la salida de emergencia del plan (ruta 3).
- Pasar de conector a mandato de cobro, o volver, es configuración más comunicación a las partes; no requiere código. Toda liquidación persiste `modo_flujo` para saber bajo qué régimen se pagó.

### 6. Precondiciones para activar mandato de cobro en producción (todas, con evidencia escrita; patrón ADR-076 §3)

1. **Sign-off legal escrito** sobre la figura: mandato de cobro, tratamiento de los fondos de terceros como no captación y fuera del perímetro CMF, y las cláusulas del contrato generado en el match (mandato, retención de comisión, no responsabilidad por daño y pérdida). ADR-027 §3 eligió no retener fondos por este riesgo; este ADR lo asume solo con ese respaldo.
2. **Cuenta bancaria de fondos de terceros** abierta y conciliación diaria operando.
3. **Capital de trabajo**: línea de confirming (ruta 1) o doble estructura (ruta 2) aprobada y probada, **o** decisión escrita del PO de operar con caja propia bajo un tope `float_maximo_terceros_clp` que la plataforma no supera (bloquea nuevas liberaciones anticipadas al alcanzarlo).
4. **Protección de datos**: autorización explícita del conductor para uso de RUT, licencia y ubicación (ley vigente desde diciembre de 2026), incorporada al onboarding.
5. **Recepción conforme operativa de punta a punta**: documento subido y confirmación del generador desde la interfaz (hoy no existe pantalla que suba el documento; censo 2026-08-16).
6. **T&Cs v3 y adendum de pronto pago v2** publicados y aceptados por las partes (el adendum v1 describe cesión y tarifa fija).

**Gate de calendario: 30 de noviembre de 2026.** Si a esa fecha no se cumple la precondición 3, el peak de enero a marzo de 2027 se opera en modo conector y la decisión se registra en `docs/handoff/CURRENT.md` en noviembre, no en enero.

### 7. Lo que queda superado y lo que se conserva

Superado: flete directo generador → transportista como único flujo posible; comisión facturada al carrier; Cobra Hoy por cesión con tarifa fija de Booster sobre el neto post-comisión. Conservado: Booster no emite DTE; underwriting y cupo por generador; tablas y flag de factoring v1; versionado de metodología; T&Cs como prerrequisito individual de cualquier cobro.

## Consecuencias

**Positivas.** El transportista cobra a 5 días con evidencia, que es el argumento de retención frente a la desintermediación ("efecto Tinder"). El anticipo vinculado a recepción conforme + GPS es un diferenciador que ningún competidor local puede ofrecer y baja la tasa. Booster acumula el historial de pago por generador. El modo conector existe desde el día uno como degradación conocida, no como improvisación.

**Negativas / deuda declarada.** (a) Capital de trabajo estructural que crece con las ventas; sin línea aprobada, el mandato de cobro no se puede operar en el peak. (b) Carga administrativa: dos cuentas, conciliación, disputas y mora del generador. (c) Riesgo regulatorio a validar por escrito antes de activar (precondición 1); este ADR no lo resuelve, lo condiciona. (d) Dependencia del operador financiero: se mitiga con la ruta 2 (segundo `partner_slug`). (e) `adelantos_carrier` nació para cesión: columnas como `partner_request_id` y `cobrado_a_shipper_en` se reinterpretan sin renombrar (expand-only). (f) El adendum Cobra Hoy v1 y los T&Cs v2 quedan obsoletos en su descripción del flujo; es trabajo legal presupuestado en octubre y noviembre (plan §4.2).

**Acciones derivadas (orden; requieren slot en `docs/frentes-vivos.md`).**

1. Spec `.specs/mandato-de-cobro/spec.md` con el modelo de estados, la tabla elegida y los criterios de éxito; junto a ella, `activacion.md` como lista de verificación de las precondiciones de §6 con su evidencia.
2. Legal (octubre–noviembre): contrato del match, cláusulas, sign-off sobre la figura, T&Cs v3, adendum v2.
3. Migración expand-only: `modo_flujo`, eventos de cobro y liberación, `float` calculable; flag `MANDATO_COBRO_ACTIVATED`.
4. Integración con el operador (API de adhesión de proveedores, anticipo y estado) reutilizando `admin-cobra-hoy` y `cobra-hoy.ts`; `factoring-methodology` v2.
5. Conciliación de fondos de terceros y métricas: `caja.float_terceros_clp` (gauge), `caja.dias_cobro_generador_p50` y `caja.dias_liberacion_transportista_p50` (histogramas), `caja.mora_generador_pct_mes` (gauge), `factoring.anticipos_pct_viajes_mes` (gauge).
6. Decisión del 30 de noviembre registrada en `docs/handoff/CURRENT.md`; recién entonces, con las seis precondiciones evidenciadas, el PO enciende el flag por Terraform.

## Verificación

1. Con `MANDATO_COBRO_ACTIVATED=false` (default, incluso con `NODE_ENV=production`), cada liquidación nueva queda con `modo_flujo='conector'` y no existe ninguna fila de fondos de terceros ni de liberación. Test análogo a `config-flags.test.ts`.
2. En un entorno de prueba con el flag en `true`: un viaje entregado con documento subido y confirmación del generador produce `recepcion_conforme_en`; la liberación al transportista queda registrada dentro de `plazo_liberacion_transportista_dias`; el cobro al generador vence a `plazo_pago_generador_dias`; el gauge `caja.float_terceros_clp` es exactamente Σ(liberado − cobrado) de los viajes vivos.
3. Un anticipo del operador solo se puede registrar sobre un viaje con recepción conforme y decisión de crédito vigente del generador; el desembolso consume cupo en la misma transacción (tests de `fix-factoring-exposicion-y-flag` siguen verdes con la base `precio_transportista_clp`).
4. Superado `float_maximo_terceros_clp` (cuando la precondición 3 se cumple por caja propia), la plataforma rechaza nuevas liberaciones anticipadas con un error explícito y una métrica; nunca en silencio.
5. `.specs/mandato-de-cobro/activacion.md` contiene evidencia de las seis precondiciones antes del flip; el flip figura en `docs/handoff/CURRENT.md` con fecha y revisión desplegada.
6. `node scripts/repo-checks/check-adr-numbering.mjs --allow-legacy 028,034,035` en verde y las cabeceras de ADR-029/032 apuntan a este ADR.
