# ADR-092 — Anexo de tipos de carga chilenos (propuesta)

> **DRAFT / no rige / pendiente visto del PO.**
> Este documento **no** está vigente. No cambia el enum `tipo_carga`, la tabla de
> compatibilidad en producción ni ningún flag (`RUTAS_API_ACTIVADA`,
> `MATCHING_ELEGIBILIDAD_MODO`). Solo investiga y propone la lista que
> [ADR-090](./090-matching-desde-la-carga-vehiculo-al-despachar.md) decisión 4
> dejó sin aprobar. Hasta que el PO acepte la lista aquí (o en una revisión
> posterior de este ADR), sigue rigiendo el enum de once valores y el anexo de
> ADR-090 permanece «sin validar».

**Estado**: DRAFT — no rige. Pendiente visto del PO para aprobar la lista.
**Fecha**: 2026-11-16
**Decider**: Felipe Vicencio (Product Owner) — **aún no decide**.
**Acota a**:
- [ADR-090](./090-matching-desde-la-carga-vehiculo-al-despachar.md), solo el
  **anexo** de tipos propuestos y la decisión 4. Las decisiones 1–3 y 5–9 de
  ADR-090 siguen vigentes y no se tocan aquí.
- No supersede a ADR-090 ni a [ADR-073](./073-tipologias-flota-configuracion-glec.md).
  Si el PO aprueba esta lista, este ADR pasa a Vigente y el anexo de ADR-090
  queda como borrador histórico (la lista canónica vive aquí).

**Spec**: [`.specs/tipos-carga-chilenos/spec.md`](../../.specs/tipos-carga-chilenos/spec.md) (Draft).

---

## Contexto

ADR-090 decidió que el matching parte de lo que la carga necesita (naturaleza,
embalaje, condiciones) y que la compatibilidad carga↔carrocería es una tabla
pura. Dejó el anexo de tipos **sin aprobar** hasta validarlo contra normas
chilenas. Hoy el producto sigue con el enum SQL/`cargoTypeSchema` de once
valores que mezcla naturaleza, rubro y forma:

`carga_seca`, `perecible`, `refrigerada`, `congelada`, `fragil`, `peligrosa`,
`liquida`, `construccion`, `agricola`, `ganado`, `otra`.

La tabla vigente en `packages/matching-algorithm` opera sobre ese enum. Los ejes
nuevos (naturaleza + embalaje) están fuera de alcance de
`.specs/matching-desde-la-carga/` §7 hasta esta validación.

---

## Investigación (fuentes consultadas 2026-11-16)

| Fuente pedida en ADR-090 | Norma concreta verificada | Qué aporta al anexo | Enlace |
|---|---|---|---|
| Reglamento Sanitario de los Alimentos | DTO 977/96 MINSAL (RSA), texto consolidado 2026 | Transporte de perecibles con frío: Art. 68 (carrocería cerrada + equipo de frío + termómetro + autorización sanitaria). Congelados: Art. 186 (−18 °C en centro térmico); Art. 190 (transporte interurbano a −18 °C, tolerancia a −15 °C). Refrigeración operativa citada en el RSA en el rango 0–5 °C (p. ej. Art. 74 y afines). | [MINSAL RSA](https://www.minsal.cl/reglamento-sanitario-de-los-alimentos/); BCN DTO 977 |
| Decreto 298 MTT | DS 298/1995 MTT, última versión 21-JUL-2022 (DTO 40) | Reglamenta transporte terrestre de sustancias peligrosas. Art. 2: se consideran peligrosas las de la Parte 3 Vol. I de las Recomendaciones ONU. Exige rótulos, antigüedad máxima del vehículo, etc. Clases 1 y 7 tienen régimen especial (Defensa / Minería). | [BCN DS 298](https://www.bcn.cl/leychile/navegar?idNorma=12087) |
| NCh 382 | NCh382:2021 (INN) — *Mercancías peligrosas – Clasificación* | Clasifica mercancías peligrosas en clases/divisiones 1–9 alineadas a ONU, con listas NU. Es la norma chilena de clasificación; DS 298 remite al listado ONU para el alcance del transporte. | [INN NCh382:2021](https://www.inn.cl/nch3822021) |
| SAG — transporte de ganado | DS 30/2012 (pub. 16-MAY-2013): Reglamento sobre protección del ganado durante el transporte; complementa Ley 19.162 y DS 240/1993 (bovinos) | Exige medio de transporte apto (piso antideslizante, ventilación, paredes lisas, divisiones, etc.). Justifica `ganado_vivo` como naturaleza distinta y carrocería tipo jaula. | [SAG DS 30](https://normativa.sag.gob.cl/Publico/Normas/DetalleNorma.aspx?id=1051151); listado SAG Ley de Carne |
| MOP / Vialidad — pesos y dimensiones | **Dimensiones**: Resolución MTT N° 1/1995 (última 23-DIC-2020): ancho 2,60 m; alto 4,20 m; largos por configuración (camión 11 m; tracto+semirremolque 18,60 m; etc.). **Pesos**: DS MOP 158/1980 (pesos por eje y bruto, tope habitual 45 t). **Autorización**: Dirección de Vialidad (Art. 63 DFL 1/2007 Ley de Tránsito; portal SPSI). | Corrige la cita genérica «norma de Vialidad» del anexo de ADR-090: dimensiones las fija MTT; pesos MOP; el permiso excepcional lo otorga Vialidad. | [BCN Res. 1](https://www.bcn.cl/leychile/navegar?idNorma=31779); [BCN DS 158](https://www.bcn.cl/leychile/Navegar?idNorma=10212); [SPSI MOP](https://spsi.mop.gob.cl/) |

Hallazgos que cambian el borrador de ADR-090:

1. **`refrigerada` / `congelada`**: el umbral «sobre / bajo 0 °C» del anexo de ADR-090 es demasiado grueso. La RSA fija congelado en **−18 °C** (transporte interurbano Art. 190) y trata la refrigeración de alimentos en torno a **0–5 °C**. La propuesta abajo alinea el texto a la RSA.
2. **`sobredimensionada`**: no basta citar «Vialidad (MOP)». Hay que nombrar Res. MTT 1/1995 + DS MOP 158 + autorización de Vialidad.
3. **`peligrosa`**: DS 298 + NCh 382:2021 confirman clases ONU 1–9; la clase ONU debe ser dato obligatorio cuando la naturaleza es `peligrosa`. Clases 1 y 7 quedan fuera del alcance operativo de Booster hasta decisión expresa (régimen especial).
4. **`general`, `granel_solido`, `granel_liquido`, `contenedor`, `forestal`**: no hay un estatuto chileno que defina esos rótulos como tipos legales de carga. Se proponen como **categorías operativas** de matching (qué carrocería sirve), no como calificaciones regulatorias. Quedan marcadas como tal.
5. **`fragil`**: se confirma que no es naturaleza: es condición de manipulación. No entra al eje 1.

---

## Decisión propuesta (NO vigente hasta visto PO)

### 1. Dos ejes + condiciones

Reemplazar el enum monolítico por:

- **Eje 1 — Naturaleza** (uno obligatorio por servicio).
- **Eje 2 — Embalaje** (uno obligatorio).
- **Condiciones** (flags opcionales, no son «tipo»): `manipulacion_fragil`, y cuando aplique campos de `clase_onu` / sobredimensión.

### 2. Anexo propuesto — Eje 1 Naturaleza

| Valor | Qué cubre | Base normativa / operativa | Veredicto research |
|---|---|---|---|
| `general` | Carga seca sin condición especial de frío, peligro, animal vivo, sobredimensión, granel ni contenedor ISO | Operativa (sin estatuto de «tipo») | Proponer |
| `granel_solido` | Áridos, granos, minerales a granel | Operativa → carrocería `tolva` / abierta según caso | Proponer |
| `granel_liquido` | Líquidos a granel en cisterna | Operativa → `cisterna`; si además es peligrosa, naturaleza `peligrosa` + embalaje `granel` + `clase_onu` | Proponer |
| `refrigerada` | Cadena de frío de alimentos u otros que exijan refrigeración (referencia RSA: ≈ 0–5 °C; no congelación) | RSA DTO 977/96 Art. 68 (+ rangos de refrigeración del RSA) | **Validado** (ajustar umbral vs ADR-090) |
| `congelada` | Producto que debe mantenerse congelado (referencia RSA: −18 °C; transporte interurbano Art. 190) | RSA Arts. 186, 190, 191 | **Validado** |
| `peligrosa` | Mercancía peligrosa; **exige `clase_onu` 1–9** | DS 298/1995; NCh382:2021 | **Validado** |
| `sobredimensionada` | Excede dimensiones MTT y/o pesos MOP; requiere autorización de Vialidad | Res. MTT 1/1995; DS MOP 158/1980; Art. 63 Ley de Tránsito / SPSI | **Validado** (fuentes corregidas) |
| `contenedor` | Contenedor marítimo ISO (20′ / 40′ van en eje 2) | Operativa → `portacontenedor` | Proponer |
| `ganado_vivo` | Animales en pie | DS SAG 30/2012 (+ DS 240/1993 bovinos) | **Validado** |
| `forestal` | Trozos y productos forestales que exigen carrocería forestal | Operativa → `forestal` | Proponer |

### 3. Anexo propuesto — Eje 2 Embalaje

| Valor | Notas |
|---|---|
| `pallet` | Carga paletizada |
| `bultos` | Bultos / cajas sueltas |
| `granel` | Sin envase de transporte unitario (sólido o líquido) |
| `contenedor_20` | Contenedor ISO 20′ |
| `contenedor_40` | Contenedor ISO 40′ |
| `unidad_completa` | La carga es la unidad (máquina, bobina, etc.) |

Sin estatuto chileno que fije este catálogo: es contrato de producto para matching y formularios. Pendiente visto PO igual que el eje 1.

### 4. Condiciones (no son tipos)

| Campo | Efecto |
|---|---|
| `manipulacion_fragil` | Reemplaza el enum `fragil`. No cambia por sí solo la carrocería elegible; informa a la oficina. |
| `clase_onu` | Obligatorio si naturaleza = `peligrosa`. Entero 1–9 según NCh 382 / ONU. |
| `requiere_autorizacion_vialidad` | Obligatorio `true` si naturaleza = `sobredimensionada`. Booster no emite el permiso; solo lo exige declarado. |

### 5. Equivalencias desde el enum actual (borrador para migración `expand`)

| Enum hoy | Naturaleza propuesta | Embalaje por defecto (revisar caso a caso) | Notas |
|---|---|---|---|
| `carga_seca` | `general` | `bultos` o `pallet` | |
| `perecible` | `refrigerada` | según formulario | Revisar caso a caso: perecible sin frío → `general` |
| `refrigerada` | `refrigerada` | igual | |
| `congelada` | `congelada` | igual | |
| `fragil` | `general` + `manipulacion_fragil` | | Deja de ser tipo |
| `peligrosa` | `peligrosa` | | Exigir `clase_onu` al editar |
| `liquida` | `granel_liquido` | `granel` | Si iba envasada, corregir a `general` + embalaje |
| `construccion` | `general` o `granel_solido` | según embalaje | |
| `agricola` | `general` o `granel_solido` | según embalaje | |
| `ganado` | `ganado_vivo` | `unidad_completa` | |
| `otra` | `general` | `bultos` | |

El relleno toca datos: necesita visto del PO en el PR de migración (ADR-090 §9; ADR-076).

### 6. Qué no decide este draft

- No enciende ni cambia `RUTAS_API_ACTIVADA` ni matching `sombra`→`activa`.
- No modifica código, SQL enum ni la tabla de 110 pares vigente.
- No aprueba la nueva matriz naturaleza×carrocería (eso va en la spec de implementación, con visto PO, cuando este ADR pase a Vigente).
- Clases ONU 1 y 7: fuera de alcance operativo hasta decisión expresa.

---

## Consecuencias (si el PO aprueba)

- Contrato de API/UI: el formulario de carga pide naturaleza + embalaje (+ condiciones).
- Migración `expand` con columnas nuevas y relleno desde equivalencias; retiro del enum viejo en `contract` posterior.
- Nueva tabla pura de compatibilidad (naturaleza × carrocería, y reglas de embalaje donde apliquen).
- El anexo de ADR-090 deja de ser la propuesta de trabajo.

## Alternativas descartadas en la research

- **Mantener el enum de once valores y solo documentar normas.** No cumple ADR-090 §2–4 (requisitos separados + tabla pura por naturaleza/embalaje).
- **Usar solo clases ONU / solo RSA como catálogo completo.** Cubren peligro y frío, no granel, forestal, contenedor ni sobredimensión.

---

## Preguntas abiertas para el PO (aprobar lista)

| # | Pregunta | Recomendación del draft |
|---|---|---|
| 1 | ¿Se aprueba el eje 1 de 10 naturalezas de la tabla §2? | Sí, con las fuentes de la research. |
| 2 | ¿Umbrales de frío en producto: refrigerada ≈ 0–5 °C y congelada −18 °C (RSA), en lugar de «sobre/bajo 0 °C»? | Sí. |
| 3 | ¿Se aprueba el eje 2 de 6 embalajes? | Sí. |
| 4 | ¿`clase_onu` obligatorio al crear/editar carga `peligrosa`? | Sí. |
| 5 | ¿Booster acepta clases ONU 1 y 7 en v1 del anexo? | No; rechazar o marcar fuera de alcance. |
| 6 | ¿Las categorías solo operativas (`general`, graneles, `contenedor`, `forestal`) entran igual? | Sí, marcadas como operativas. |

Sin respuesta afirmativa a la lista, **este ADR sigue DRAFT y no rige**.
