# ADR-090 — El matching parte de la carga y el vehículo se fija al despachar

**Estado**: Vigente. El PO cerró las decisiones de la sección final el 2026-11-10. El anexo de tipos de carga sigue sin validar y no rige.
**Fecha**: 2026-11-09
**Decider**: Felipe Vicencio (Product Owner).
**Acota a**:
- [ADR-023](./023-matching-algorithm-v1-greedy-capacity-scoring.md) y [ADR-033](./033-matching-algorithm-v2-multifactor-backhaul-aware.md). Cambia la elegibilidad (qué empresas reciben oferta) y deja de fijar el vehículo en la oferta. El puntaje y el orden de candidatos siguen vigentes.
- [ADR-073](./073-tipologias-flota-configuracion-glec.md). La capacidad y la carrocería que usa el matching son las de la configuración completa.

Se relaciona con [ADR-088](./088-ruta-parada-servicio.md): el vehículo se declara en la ruta. No supersede a ninguno.

**Spec**: por escribir (`.specs/matching-desde-la-carga/spec.md`). Dominio crítico (matching): TDD con rojo exhibido.

---

## Contexto

Lo que hace hoy el código (`apps/api/src/services/matching.ts`, `offer-actions.ts`):

- Por cada empresa candidata elige un vehículo: el activo de menor `capacidad_kg` que alcanza para el peso. Lo guarda en `ofertas.vehiculo_sugerido_id`.
- Al aceptar la oferta, ese vehículo pasa a `asignaciones.vehiculo_id`, que es `NOT NULL`. La transportista acepta una carga y un camión en el mismo acto.
- La capacidad que se compara es la de la unidad motriz. No suma la del carro o semirremolque.
- No se compara el tipo de carga con la carrocería. Una carga refrigerada puede ofrecerse a una empresa cuyo único vehículo apto por peso es una tolva.
- `tipo_carga` es una sola lista de once valores que mezcla naturaleza (`refrigerada`, `peligrosa`), rubro (`construccion`, `agricola`) y forma (`liquida`).

Consecuencias: una transportista que sí puede llevar la carga con tracto y semirremolque no recibe la oferta; otra la recibe sin tener con qué llevarla; y quien acepta queda atado a un camión que eligió el sistema días antes de la recogida.

## Decisión

1. **La oferta es a la empresa, no a un camión.** El matching parte de lo que la carga necesita y pregunta qué empresas tienen con qué llevarla.

2. **Requisitos de la carga.** Peso, volumen cuando está declarado, naturaleza, forma de embalaje y condiciones (temperatura controlada, carga peligrosa, sobredimensión). Salen del servicio; los tipos están en el anexo.

3. **Elegibilidad por configuración.** Una empresa es candidata si tiene al menos una configuración activa (unidad motriz más sus arrastres, ADR-073) que cumple a la vez:
   - capacidad útil de la configuración ≥ peso de la carga, y volumen cuando aplica;
   - carrocería compatible con la naturaleza y el embalaje de la carga.

4. **La compatibilidad es una tabla pura.** La relación entre tipo de carga y carrocería vive en `packages/matching-algorithm` como dato y función pura, con test por cada par. No va escrita dentro de un servicio.

5. **Aceptar no exige vehículo.** `asignaciones.vehiculo_id` deja de ser obligatorio al aceptar. `ofertas.vehiculo_sugerido_id` se mantiene como sugerencia visible para la oficina.

6. **El vehículo se fija al despachar.** La transportista declara la configuración y el conductor en la ruta (ADR-088). Sin vehículo y conductor declarados no se puede confirmar la recogida. El vehículo declarado debe cumplir la elegibilidad del punto 3; si no la cumple, el sistema lo rechaza con el motivo.

7. **La huella siempre tiene vehículo.** Como no hay recogida sin vehículo declarado, todo servicio recogido tiene con qué calcular su huella. Antes de declararlo, la estimación usa los valores por defecto de la clase más chica que cumple la elegibilidad, y se recalcula al declararlo.

8. **Cambio de vehículo.** Antes de la recogida la transportista lo cambia libremente dentro de la elegibilidad. Después de la recogida un cambio es un transbordo y queda fuera de alcance.

9. **Migración.** `expand`: `asignaciones.vehiculo_id` pasa a nullable, y se agregan los campos de requisitos de la carga. El enum `tipo_carga` no se modifica en sitio: los ejes nuevos se agregan como columnas, se rellenan desde el valor actual con una tabla de equivalencias revisada por el PO, y el enum viejo se retira en una `contract` posterior. El relleno toca datos: necesita el visto del PO en su PR.

## Consecuencias

- Reciben oferta las empresas que pueden llevar la carga con carro, que hoy quedan fuera.
- Dejan de recibirla las que no tienen carrocería apta.
- El formulario de la carga pide más: naturaleza y embalaje en vez de un solo tipo. Es un cambio de contrato de interfaz y de API.
- Aparece un estado nuevo en la operación: carga aceptada sin camión declarado. Necesita aviso a la oficina y un plazo (decisión abierta 1).
- La tabla de compatibilidad es una regla de negocio que alguien debe mantener.

## Alternativas descartadas

- **Mantener el vehículo fijado y permitir cambiarlo después.** Sigue ofreciendo según un solo camión y sigue sin contar el carro.
- **Filtrar por carrocería dentro del puntaje.** Una carrocería que no sirve no es un candidato peor: no es candidato.

## Decisiones del PO

El PO aceptó las cuatro recomendaciones el 2026-11-10. La decisión 4 deja el anexo sin aprobar: la lista de tipos no rige hasta validarla contra las normas indicadas, y su aprobación va en un ADR o una spec posterior.

| # | Pregunta | Decisión |
|---|---|---|
| 1 | ¿Hasta cuándo puede la transportista declarar el vehículo? | Hasta el inicio de la ventana de recogida, con recordatorios a la oficina. Pasado ese momento, aviso al generador. |
| 2 | ¿Se acepta un camión de un tercero (subcontratado)? | Sí, registrado por la transportista como unidad de tercero, con patente y tipología. La responsabilidad ante el generador sigue siendo de quien aceptó. La huella se calcula con ese vehículo y su nivel de certificación sale de la fuente de posición disponible (ADR-077). |
| 3 | ¿Ve el generador el vehículo antes de la recogida? | Sí, en cuanto se declara. Antes ve «por asignar». |
| 4 | ¿Se aprueba la lista de tipos del anexo? | Solo después de validarla con las fuentes indicadas. |

---

## Anexo — Tipos de carga propuestos (sin validar)

Esta lista es una propuesta de trabajo. Las referencias normativas están escritas de memoria y **deben verificarse contra la norma vigente** antes de aprobarla; ninguna se da por confirmada aquí.

**Eje 1 — Naturaleza**

| Valor propuesto | Qué cubre | Fuente por verificar |
|---|---|---|
| `general` | Carga seca sin condición especial | — |
| `granel_solido` | Áridos, granos, minerales | — |
| `granel_liquido` | Líquidos en cisterna | — |
| `refrigerada` | Cadena de frío sobre 0 °C | Reglamento Sanitario de los Alimentos |
| `congelada` | Bajo 0 °C | Reglamento Sanitario de los Alimentos |
| `peligrosa` | Con clase ONU 1 a 9 como dato obligatorio | Decreto 298 del Ministerio de Transportes; NCh 382 |
| `sobredimensionada` | Excede peso o dimensiones máximas; requiere autorización | Norma de pesos y dimensiones de Vialidad (MOP) |
| `contenedor` | Contenedor marítimo | — |
| `ganado_vivo` | Animales en pie | Normativa de transporte de ganado del SAG |
| `forestal` | Trozos y productos forestales | — |

**Eje 2 — Embalaje**: `pallet`, `bultos`, `granel`, `contenedor_20`, `contenedor_40`, `unidad_completa`.

**Equivalencias desde el enum actual** (borrador): `carga_seca` → `general`; `perecible` → `refrigerada` (revisar caso a caso); `refrigerada`, `congelada`, `peligrosa` → igual; `liquida` → `granel_liquido`; `construccion` → `general` o `granel_solido` según embalaje; `agricola` → `general` o `granel_solido`; `ganado` → `ganado_vivo`; `fragil` → `general` con una marca de manipulación; `otra` → `general`.

`fragil` deja de ser un tipo: es una condición de manipulación que no cambia el camión que se necesita.
