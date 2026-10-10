# RFP — Verificación externa de la metodología de huella de carbono (GLEC Framework v3.0)

**Versión**: 2 (actualizada al estado de octubre de 2026)
**Emisión original**: 2026-05-18 · **Actualización**: 2026-10-08
**Responsable**: Felipe Vicencio, Product Owner (`dev@boosterchile.com`)
**Empresa**: Booster Chile SpA — Booster AI, mercado B2B de logística sostenible en Chile
**Criterio que cierra**: T10-27 de `.specs/trl10/spec.md` (certificado emitido por auditor tercero, archivado en `docs/compliance/`)
**Referencias**: [ADR-021](../adr/021-glec-v3-compliance.md) (GLEC v3.0), [ADR-022](../adr/022-emissions-methodology-and-wtw-factor.md) (metodología y factor WTW), [ADR-015](../adr/015-kms-pkcs1-rsa-4096-sha256-certificates.md) (firma de certificados con KMS), [ADR-028](../adr/028-dual-source-data-model-teltonika-vs-maps.md) (modelo de datos de doble fuente y niveles de certificación), [ADR-073](../adr/073-tipologias-flota-configuracion-glec.md) (tipologías de flota), [ADR-077](../adr/077-nivel-certificacion-por-fuente-de-posicion.md) (nivel por fuente de posición), [`docs/research/013-glec-audit.md`](../research/013-glec-audit.md) (auditoría interna), [`packages/carbon-calculator/`](../../packages/carbon-calculator/), [`packages/certificate-generator/`](../../packages/certificate-generator/)
**Estado**: listo para enviar (PO) — ver §8

---

## 1. Objetivo

Contratar a un verificador externo independiente que evalúe la conformidad de la metodología con que Booster AI estima y certifica la huella de carbono de cada viaje de transporte de carga con el **GLEC Framework v3.0** (Smart Freight Centre) y, en lo que corresponda, con la **ISO 14083** y el **GHG Protocol**, y que emita un **certificado o declaración de conformidad** de esa metodología.

El certificado permitirá:

- Indicar en cada certificado de viaje que la metodología está verificada por un tercero, con su número de registro.
- Respaldar ante clientes generadores de carga y sus auditores ESG los datos que Booster les entrega.

## 2. Qué hace hoy la metodología

### 2.1. Cálculo

El cálculo vive en `packages/carbon-calculator` (funciones puras, sin acceso a base de datos) y lo orquesta `apps/api` al entregar un viaje.

- **Factores *well-to-wheel* para Chile** (`src/factores/sec-chile-2024.ts`): por combustible (diésel B5, gasolina, GLP, GNC, eléctrico, híbridos, hidrógeno), con su componente *tank-to-wheel* y *well-to-tank*, densidad energética, año de referencia y fuente. Fuentes declaradas en el código: GLEC Framework v3.0, IPCC AR6 GWP-100 (CO₂, CH₄ y N₂O; excluye contaminantes locales), DEFRA 2024 como contraste, Decreto Supremo N° 60/2010 (mezcla B5) y el factor del Sistema Eléctrico Nacional del Coordinador Eléctrico Nacional para vehículos eléctricos. Ejemplo: diésel B5 con TTW 2,70 y WTT 0,55 kg CO₂e/L (WTW 3,25).
- **Tres modos según el dato disponible** (`src/modos/`):
  - `exacto_canbus`: consumo real leído del bus CAN por el dispositivo Teltonika y distancia por GPS.
  - `modelado`: distancia de la ruta (Google Routes API o GPS) y perfil energético declarado del vehículo.
  - `por_defecto`: valores genéricos por tipo de vehículo cuando no hay perfil declarado.
- **Factor de carga y retorno vacío** (`src/glec/factor-carga.ts`, `src/glec/empty-backhaul.ts`): ajuste del consumo por carga transportada y asignación de las emisiones del retorno vacío al tramo cargado según GLEC v3.0, ponderada por el factor de retorno logrado por la asignación de cargas.
- **Tipologías de flota** (ADR-073): configuraciones de vehículo para seleccionar los valores por defecto.

### 2.2. Nivel de certificación

El nivel de cada certificado **lo calcula el sistema; ningún usuario lo puede declarar** (`src/certificacion/derivar-nivel.ts`). Combina tres dimensiones: modo de cálculo, fuente de la traza (`teltonika_gps`, `movil_gps`, `maps_directions`, `manual_declared`) y cobertura de la traza.

| Nivel | Condición resumida | Incertidumbre de base publicada |
|---|---|---|
| `primario_verificable` | CAN + traza Teltonika con cobertura ≥ 95 % | ±5 % |
| `secundario_modeled` | Datos modelados o traza parcial; la traza del teléfono (`movil_gps`) nunca alcanza el nivel primario (ADR-077) | ±15 % |
| `secundario_default` | Ruta declarada manualmente, sin telemetría ni ruta calculada | ±30 % |

Los valores de incertidumbre están en `src/certificacion/factor-incertidumbre.ts`, con referencia a ISO 14083 y al anexo de calidad de datos de GLEC v3.0. Cada certificado imprime el método y su incertidumbre.

### 2.3. Certificado del viaje

- PDF generado por `packages/certificate-generator`, con firma **PAdES-B-B** cuyo firmante es una clave **RSA 4096 / SHA-256 en Cloud KMS** (ADR-015). La cadena es una CA propia de Booster, no una CA pública.
- Verificación pública por código de seguimiento: `GET /certificates/:tracking_code/verify`.
- Se emite automáticamente al entregar un viaje que mide huella: el viaje la mide si lo indica su propia configuración o, en su defecto, si el generador o el transportista activaron la medición (`apps/api/src/services/resolver-opt-in-huella.ts`).

### 2.4. Estado real de los datos (base para la muestra)

A la última verificación de producción registrada en `docs/handoff/CURRENT.md` (2026-09-22): 6 viajes entregados y 5 certificados emitidos, todos `secundario_modeled`; ningún certificado `primario_verificable` todavía (es el criterio T10-05). La flota con Teltonika tiene 8 vehículos, con disponibilidad de datos CAN dispar. La muestra de §3.3 se completa con viajes reales a medida que se generen y con casos de prueba sintéticos claramente marcados.

## 3. Alcance de la verificación

### 3.1. Dentro del alcance

| Ítem | Ubicación |
|---|---|
| Conformidad de la metodología con GLEC v3.0 (alcance, límites del sistema, WTW, asignación, retorno vacío) | `packages/carbon-calculator/src/` + ADR-021, ADR-022 |
| Factores de emisión, sus fuentes y su política de actualización anual | `src/factores/` |
| Modos de cálculo y reglas para elegir cada uno | `src/modos/`, `apps/api/src/services/calcular-metricas-viaje.ts` |
| Derivación del nivel de certificación e incertidumbre publicada | `src/certificacion/`, ADR-028, ADR-077 |
| Flujo de datos de telemetría al cálculo (CAN, GPS, cobertura) | `apps/telemetry-processor`, `packages/codec8-parser`, `apps/api/src/services/calcular-cobertura-telemetria.ts` |
| Contenido, firma y verificabilidad del certificado de viaje | `packages/certificate-generator`, `apps/api/src/services/emitir-certificado-viaje.ts` |
| Pruebas unitarias con valores esperados | `packages/carbon-calculator/src/**/*.test.ts` y `test/` |

### 3.2. Fuera del alcance

- Calidad operacional de la telemetría en terreno (fallas de dispositivos, pérdida de señal) más allá de cómo la metodología la refleja en el nivel y la incertidumbre.
- Documentos tributarios: Booster no emite DTE (ADR-069); no hay integración con el SII que auditar.
- Declaraciones de compensación o neutralidad de carbono: Booster no las hace; solo estima y certifica emisiones.
- Gases o contaminantes fuera de CO₂e (NOx, material particulado, SOx).
- Seguridad de la plataforma (RFP aparte, `docs/audits/security-rfp.md`).

### 3.3. Muestra

Booster entrega, dentro de 2 semanas desde la firma, un conjunto de viajes con sus entradas y salidas de cálculo, que cubra los tres modos, las cuatro fuentes de traza y los tres niveles, con viajes reales donde existan y casos sintéticos marcados donde no. Se acuerda con el verificador el tamaño y la composición mínima.

## 4. Entregables

| # | Entregable | Formato |
|---|---|---|
| 1 | Certificado o declaración de conformidad con GLEC v3.0, con número de registro y vigencia | PDF firmado por el verificador |
| 2 | Informe de verificación con hallazgos por requisito (GLEC, ISO 14083, GHG Protocol según aplique) | PDF |
| 3 | Registro de hallazgos priorizado (mayor, menor, observación) | PDF o Markdown |
| 4 | Declaración de independencia del verificador | Carta |
| 5 | Texto autorizado para citar la verificación en la Plataforma, en el sitio y en los certificados de viaje | Texto breve |

## 5. Criterios de aceptación

- El trabajo se acepta cuando el verificador **emite el certificado** (entregable 1) sin hallazgos mayores abiertos.
- Los hallazgos menores y observaciones quedan registrados con plan de acción y no bloquean T10-27.
- El certificado se archiva en `docs/compliance/` (PDF original sin editar y un registro en Markdown con número, alcance, vigencia y verificador), según `docs/compliance/README.md`.

## 6. Plazos

| Hito | Plazo |
|---|---|
| Respuesta de verificadores | 2 semanas desde el envío |
| Selección y contrato | 2 semanas desde la última respuesta |
| Entrega de la muestra | ≤ 2 semanas desde la firma |
| Primera ronda de hallazgos | ≤ 3 semanas desde la entrega de la muestra |
| Respuesta a hallazgos | Booster, ≤ 2 semanas por ronda; al menos 2 rondas incluidas |
| Emisión del certificado | ≤ 8 semanas desde la firma |

Validez esperada del certificado: al menos 12 meses, con opción de renovación anual.

## 7. Propuesta comercial solicitada

El verificador cotiza: precio fijo por el alcance de §3, rondas adicionales, renovación anual, condiciones de pago y forma de contratación. El presupuesto lo fija el PO (OQ-2 de la spec TRL 10) y el contrato lo revisa el abogado de Booster.

**Referencia interna de mercado** (borrador del 2026-05-18, sin validar desde entonces): USD 8 000 – 25 000 por este alcance. Sirve para evaluar propuestas; no se comparte con el proveedor.

**Criterios de selección**: acreditación para verificación de gases de efecto invernadero ante un organismo reconocido por IAF o ILAC; experiencia con GLEC Framework o ISO 14083 en transporte y logística; capacidad de trabajar en Chile o en forma remota con Chile; independencia respecto de Booster y sus proveedores.

## 8. Envío

**Estado**: listo para enviar (PO).

El envío lo hace el PO. Esta tabla se completa a medida que se contacta a verificadores. Las propuestas recibidas no se versionan en el repo.

Lista corta del borrador del 2026-05-18 (el PO valida y completa):

| Proveedor | Contacto | Presencia en Chile | Fecha de envío | Respuesta |
|---|---|---|---|---|
| SGS Chile | https://www.sgs.cl/es-es/contactenos | Oficinas en Santiago | | |
| Bureau Veritas Chile | https://www.bureauveritas.cl/contacto | Oficinas en Santiago y Concepción | | |
| DNV LATAM | https://www.dnv.com.br/contact/index.html | Oficinas en Brasil y Argentina; servicio remoto a Chile | | |

### 8.1. Texto sugerido para el envío

```
Asunto: Solicitud de propuesta — verificación de metodología GLEC v3.0 (Booster AI, Chile)

Estimados:

Soy Felipe Vicencio, de Booster AI, una plataforma B2B de logística
sostenible que opera en Chile y emite un certificado de huella de carbono
por cada viaje de transporte de carga.

Buscamos una verificación independiente de nuestra metodología de cálculo
frente al GLEC Framework v3.0 (y, en lo que corresponda, ISO 14083 y GHG
Protocol), con emisión de un certificado o declaración de conformidad.

Adjunto el detalle del alcance, entregables, criterios de aceptación y
plazos. Agradeceré confirmar si el trabajo calza con su práctica, una
propuesta con precio y plazos, y cualquier pregunta sobre el alcance.

Saludos,
Felipe Vicencio
Booster AI · dev@boosterchile.com
```

## 9. Registro de cambios

- **2026-05-18** — Primera versión (S0 T6), con lista corta de verificadores y rango de precio de referencia.
- **2026-10-08** — Actualización al estado real (T10-27): descripción de la metodología tal como está en el código (factores WTW, tres modos, niveles derivados, incertidumbre, firma PAdES con KMS), datos reales disponibles y alcance sin DTE (ADR-069). Se conservan la lista corta de verificadores y el rango de referencia del borrador de mayo (la elección y el presupuesto siguen siendo del PO); se quita la mención a competidores. Criterio de aceptación explícito: certificado emitido.
