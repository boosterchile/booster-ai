# ADR-095 — Asignación en Booster Spot: el generador elige, con precio fijo o con ofertas de precio

**Estado**: Propuesta. Recoge lo que el PO indicó el 2026-11-25; los puntos de la sección «Por confirmar» no están decididos. No rige hasta que el PO la acepte.
**Fecha**: 2026-11-25
**Decider**: Felipe Vicencio (Product Owner).
**Acota a**:
- [ADR-004](./004-uber-like-model-and-roles.md): la asignación deja de ser siempre «el primero que acepta».
- [ADR-090](./090-matching-desde-la-carga-vehiculo-al-despachar.md): no cambia la elegibilidad ni que el vehículo se fije al despachar. Cambia qué significa aceptar.
- [ADR-094](./094-comision-dentro-del-precio-del-generador.md): la regla de comisión es la misma; se agrega el cálculo cuando el precio lo propone el transportista.

**Spec**: por escribir (`.specs/asignacion-el-generador-elige/spec.md`). Dominio crítico (matching y dinero): TDD con rojo exhibido.

## Contexto: cómo asigna Booster hoy

Verificado en `main` (`7ff12fb`), leyendo `apps/api/src/services/matching.ts`, `offer-actions.ts`, `reclamar-viaje.ts`, `packages/matching-algorithm` y `packages/trip-state-machine`.

1. **Al publicar corre el matching.** Busca empresas transportistas activas con el servicio de ofertas de carga, con una zona de recogida en la región del origen y con flota que pueda llevar la carga (ADR-090). Las ordena y crea ofertas para las 5 primeras (`MAX_OFFERS_PER_REQUEST`), que vencen a los 60 minutos (`OFFER_TTL_MINUTES`).
2. **Queda asignado el primero que acepta.** `acceptOffer` crea la asignación en la misma transacción y marca las demás ofertas como reemplazadas. El generador no interviene.
3. **El precio lo fija el generador.** La oferta copia el precio publicado; el transportista acepta o rechaza, no propone.
4. **Reclamar** (BARH-23, aceptada el 2026-11-16): un transportista con zona en el origen puede tomar una carga abierta que el matching no le ofreció. También asigna de inmediato.
5. **El orden de candidatos.** Hay dos fórmulas. La v1 solo premia que el camión no quede grande para la carga. La v2 (ADR-033) da el mayor peso (0,35) a que el transportista ya tenga un camión yendo hacia el origen. El código trae la v2 apagada por defecto, pero la infraestructura la enciende (`matching_algorithm_v2_activated`, por defecto `true`, con la nota «Activado en prod desde 2026-05-07»). No se comprobó el valor aplicado en el servicio en producción. La elegibilidad por carga también está activa por defecto en la infraestructura.
6. **Solo el generador puede cancelar** (`PATCH /trip-requests/:id/cancelar`). El enum `actor_cancelacion` ya tiene el valor `transportista`, pero no hay ruta para que un transportista desista, y la máquina de estados no tiene camino de `asignado` de vuelta a buscar transportista.
7. **Una carga cuyas ofertas vencen todas** debería pasar a `expirado` por un proceso posterior, según el comentario de `rejectOffer`. No se encontró ese proceso en `apps/api/src/jobs` ni en los servicios.

## Lo que indicó el PO (2026-11-25)

- El generador puede elegir un transportista, o subir su requerimiento para que los transportistas ofrezcan su servicio.
- Con precio fijo: todos aceptan la oferta del generador y el generador decide a quién asigna.
- También puede ocurrir que el generador ofrezca un servicio y los transportistas hagan su oferta de precio. Lo difícil ahí es el cobro de la comisión.
- El generador elige entre las ofertas recibidas según la modalidad. Todas las opciones deben ser posibles.
- El modelo que se replica es el de Uber: el viaje se puede cancelar, también por el transportista.

## Decisión propuesta

### 1. Cuatro formas de asignar, que el generador elige al publicar

| Forma | Quién pone el precio | Quién decide | Estado |
|---|---|---|---|
| **Automática** | El generador | El primero que acepta | Existe: es la de hoy |
| **Elijo yo** | El generador | El generador, entre quienes aceptaron | Nueva |
| **Pido ofertas** | Cada transportista | El generador, entre las ofertas | Nueva |
| **Directa** | El generador | El generador invita a un transportista; si no acepta, la carga pasa a otra forma | Nueva |

Las cuatro usan el mismo matching para decidir a quién se invita y en qué orden se le muestra al generador.

### 2. Aceptar pasa a ser postular, salvo en la forma automática

En «Elijo yo» y «Pido ofertas», la aceptación del transportista es un compromiso firme que no asigna. La asignación ocurre cuando el generador elige. Reclamar una carga abierta pasa a ser postular sin invitación.

La carta de porte se perfecciona con las dos aceptaciones, igual que hoy: el transportista acepta sus términos al postular y el generador al elegir.

### 3. La comisión cuando el transportista propone el precio

La regla de ADR-094 no cambia: la comisión está dentro del precio que paga el generador. Lo que cambia es el sentido del cálculo, porque el transportista solo ve lo que recibe.

- El transportista oferta **lo que quiere recibir** (neto), `R`.
- El sistema calcula el precio del viaje: `P = redondear(R / (1 − tasa))`. La comisión de Booster es `P − R`.
- El generador ve `P` más IVA, con sus dos facturas. Nunca ve `R`.

Ejemplo con tasa de 5 %: el transportista oferta recibir 95.000; el generador ve un viaje de 100.000 netos (119.000 con IVA); Booster factura 5.000 más IVA y el transportista 95.000 más IVA. Calculando la comisión como `P − R`, el transportista recibe exactamente lo que ofertó; la tasa efectiva puede diferir de la configurada en menos de un peso por el redondeo.

La tasa es la congelada al publicar (`comisionPctAplicada`), así que todas las ofertas de una carga se comparan con la misma tasa.

### 4. Cancelación por el transportista

Un transportista asignado puede desistir antes del retiro. La carga vuelve a buscar transportista con las mismas condiciones, y el generador recibe el aviso. Las consecuencias son las de las condiciones generales de transporte ya aprobadas: sin costo hasta 2 horas antes de la ventana de retiro y antes de que el camión salga; después, no cobra, responde por los perjuicios y puede ser suspendido. Cada desistimiento queda registrado y cuenta para su orden en el matching.

Necesita una transición nueva en la máquina de estados (`asignado` → `esperando_match`), la ruta para desistir y la anulación de la carta de porte de esa asignación.

### 5. Quién puede postular, elegir y desistir

Dueño, administrador y despachador de la empresa. El conductor no (decisión del PO del 2026-11-25).

## El matching, después de todos los cambios

**Lo que se mantiene.** La elegibilidad por carga (ADR-090), la oferta a la empresa y no al camión, el vehículo al despachar, y el filtro por servicio contratado: una empresa con Booster Fleet solo no recibe ofertas.

**Lo que cambia de papel.** El matching deja de decidir quién se lleva la carga, salvo en la forma automática. Pasa a decidir a quién se invita y en qué orden ve el generador a los postulantes. Por eso el orden debe poder explicarse en pantalla: retorno con carga, huella esperada, precio.

**Lo que hay que revisar.**

- **El límite de 5 invitaciones y los 60 minutos.** Sirven para «el primero que acepta». Para que el generador elija, 5 invitados pueden dejarlo con una sola postulación. Deben ser configurables por forma de asignar.
- **El plazo para elegir.** Hoy no existe porque nadie elige. Una carga inmediata (retiro dentro de 24 horas) no puede esperar indefinidamente a que el generador decida.
- **El retorno con carga como criterio visible.** La fórmula v2 ya ordena premiando al transportista que va hacia el origen, que es el origen del proyecto y la mitad del lema. Hoy ese orden no lo ve nadie, porque gana el primero que acepta. Cuando el generador elija, el motivo «retorno con carga» tiene que mostrarse, y conviene confirmar en producción que la v2 es la que está corriendo.
- **Las cargas que nadie toma.** Falta confirmar qué las cierra hoy (punto 7 del contexto) y definir qué ve el generador: volver a publicar, subir el precio o cambiar de forma.
- **El precio como criterio.** Con «Pido ofertas», el precio entra al orden por primera vez. La fórmula v2 no lo considera: hay que decidir si entra al orden o si solo se muestra.

## Por confirmar con el PO

1. **Forma por defecto.** Propuesta: automática para la carga inmediata y «Elijo yo» para la programada, con las otras disponibles en ambas.
2. **Plazo para elegir y qué pasa si vence.** Propuesta: en la carga inmediata, se asigna al primero del orden; en la programada, la carga vuelve a quedar abierta y se avisa al generador.
3. **Ofertas de precio cerradas.** Propuesta: cada transportista ve solo la suya.
4. **Qué ve el generador de cada postulante antes de elegir.** Propuesta: empresa, viajes hechos en Booster, si es un retorno con carga, huella esperada con su sello y, en «Pido ofertas», el precio.
5. **Forma directa: entre quiénes elige.** Propuesta: entre los transportistas con los que ya hizo viajes en Booster.
6. **Tope de precio en «Pido ofertas».** Si el generador puede fijar un máximo que las ofertas no superen.

## Consecuencias

- Cambia el significado del estado `aceptada` de una oferta en dos de las cuatro formas; hacen falta estados nuevos para «postulada» y «elegida», y uno del viaje para «esperando elección».
- La forma automática queda como está, así que las cargas ya publicadas no se ven afectadas.
- `GeneradorElegir` del rediseño deja de contradecir el modelo.
- El frente 3 de `.specs/comision-dentro-del-precio/spec.md` (la oferta muestra lo que recibe el transportista) es requisito de «Pido ofertas».

## Alternativas descartadas

- **Dejar solo «el primero que acepta».** Es lo más rápido, pero el PO pidió que el generador pueda elegir.
- **Que el transportista oferte el precio que paga el generador.** Obliga a mostrarle la comisión para que entienda cuánto recibe, y ADR-094 lo impide.
