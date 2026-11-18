# Plan: matching-desde-la-carga

- **Spec**: [spec.md](./spec.md) (aceptada el 2026-11-11)
- **Date**: 2026-11-11
- **Status**: Aprobado por el PO en el chat del 2026-11-11 («Apruebo todo»): la tabla de §1.1 completa, con los 26 pares dudosos como están propuestos, y las dos reglas de §2.

Este documento cubre la parte 1 de la spec: la tabla de compatibilidad y las
funciones de elegibilidad. Las partes 2 a 6 se planifican cuando esta esté en
main.

## 1. Tabla de compatibilidad propuesta

Filas: los 11 valores de `tipo_carga`. Columnas: los 10 valores de
`tipo_carroceria`. Son 110 pares.

- **sí**: una empresa con esa carrocería puede recibir la oferta.
- **no**: no la recibe por esa carrocería.
- **sí?** / **no?**: par dudoso. Es mi recomendación, con el motivo en §1.2.

La tabla sale de criterio operativo general. **No está tomada de una norma ni
validada con una transportista.** Es justamente lo que el PO aprueba o corrige.

### 1.1 Los 110 pares

| `tipo_carga` | plano | cortina | furgón cerrado | refrigerado | tolva | cisterna | porta-contenedor | cama baja | jaula | forestal |
|---|---|---|---|---|---|---|---|---|---|---|
| `carga_seca` | sí | sí | sí | sí? | no | no | no? | no | no | no |
| `perecible` | no | no? | sí? | sí | no | no | no | no | no | no |
| `refrigerada` | no | no | no | sí | no | no | no? | no | no | no |
| `congelada` | no | no | no | sí? | no | no | no? | no | no | no |
| `fragil` | no? | sí | sí | sí? | no | no | no | no | no | no |
| `peligrosa` | sí? | sí? | sí | no | no | sí | no? | no | no | no |
| `liquida` | no? | no? | no? | no | no | sí | no | no | no | no |
| `construccion` | sí | sí? | sí? | no | sí | no | no | sí? | no | no |
| `agricola` | sí | sí | sí | sí? | sí | no | no | no | no | no |
| `ganado` | no | no | no | no | no | no | no | no | sí | no |
| `otra` | sí | sí | sí | no? | no? | no? | no? | no? | no? | no? |

Resultado: 30 pares en «sí» (20 firmes y 10 dudosos) y 80 en «no» (64 firmes y
16 dudosos).

### 1.2 Los 26 pares dudosos

| # | Par | Propuesta | Por qué dudo |
|---|---|---|---|
| 1 | `carga_seca` × refrigerado | sí | Un refrigerado con el equipo apagado lleva carga seca, y es un retorno frecuente. Negarlo deja camiones volviendo vacíos. |
| 2 | `carga_seca` × portacontenedor | no | Solo sirve si la carga va en contenedor, y el tipo de carga no lo dice. |
| 3 | `perecible` × furgón cerrado | sí | Hay perecibles que no llevan frío (fruta y verdura en trayecto corto, pan). El tipo no distingue. |
| 4 | `perecible` × cortina | no | Mismo caso que el 3, con menos protección. Si se acepta el 3 se podría aceptar este. |
| 5 | `refrigerada` × portacontenedor | no | Existe el contenedor refrigerado, pero la carrocería no dice si el chasis lleva uno. |
| 6 | `congelada` × refrigerado | sí | La carrocería no distingue un equipo que llega a −18 °C de uno que solo enfría. Si se niega, ninguna carga congelada tiene candidatas. |
| 7 | `congelada` × portacontenedor | no | Igual que el 5. |
| 8 | `fragil` × plano | no | Carga expuesta. Hay frágil que viaja en plano bien estibado (vidrio en caballete). |
| 9 | `fragil` × refrigerado | sí | Es una caja cerrada; sirve igual que un furgón. |
| 10 | `peligrosa` × plano | sí | Cilindros y tambores viajan en plano. Depende de la clase de la sustancia, que hoy no se registra. |
| 11 | `peligrosa` × cortina | sí | Igual que el 10. |
| 12 | `peligrosa` × portacontenedor | no | Isotanques y contenedores con carga peligrosa existen; el tipo no lo dice. |
| 13 | `liquida` × plano | no | Líquido envasado (tambores, contenedores de mil litros) viaja en plano. Leo `liquida` como granel líquido, igual que el anexo de ADR-090. |
| 14 | `liquida` × cortina | no | Igual que el 13. |
| 15 | `liquida` × furgón cerrado | no | Igual que el 13. |
| 16 | `construccion` × cortina | sí | Materiales paletizados: cemento en sacos, cerámica, planchas. |
| 17 | `construccion` × furgón cerrado | sí | Igual que el 16, para terminaciones. |
| 18 | `construccion` × cama baja | sí | Maquinaria de obra. No sirve para áridos ni materiales. |
| 19 | `agricola` × refrigerado | sí | Fruta de exportación. Se solapa con `perecible` y `refrigerada`. |
| 20 | `otra` × refrigerado | no | `otra` no dice nada de la carga. Propongo ofrecerla solo a las tres carrocerías de uso general. |
| 21 | `otra` × tolva | no | Igual que el 20. |
| 22 | `otra` × cisterna | no | Igual que el 20. |
| 23 | `otra` × portacontenedor | no | Igual que el 20. |
| 24 | `otra` × cama baja | no | Igual que el 20. Hoy la maquinaria no tiene un tipo propio y caería aquí. |
| 25 | `otra` × jaula | no | Igual que el 20. |
| 26 | `otra` × forestal | no | Igual que el 20. Hoy los trozos no tienen un tipo propio y caerían aquí. |

### 1.3 Lo que la tabla no puede decir

Son límites del enum `tipo_carga` de hoy, no de la tabla. Los resuelven los
ejes nuevos del anexo de ADR-090 cuando se validen (spec §7).

- **Ninguna carga llega a la carrocería forestal**, y solo `construccion`
  llega a la cama baja. No hay tipo de carga para trozos ni para maquinaria.
- **Ninguna carga llega al portacontenedor.** No hay tipo «contenedor».
- **Carga peligrosa:** la tabla mira la carrocería, no la habilitación del
  vehículo ni del conductor para llevarla. El sistema no registra esa
  habilitación.
- **Congelada:** una carrocería `refrigerado` no garantiza −18 °C.

## 2. Dos reglas que la spec da por definidas y no lo están

La spec §3.2 dice que la capacidad útil y la carrocería efectiva de una
configuración «se calculan como fija ADR-073». Al leer ADR-073 para citarlo,
no las fija: define las tipologías y la clase de emisiones de la
configuración, pero no esas dos reglas. Las propongo aquí para que el PO las
apruebe junto con la tabla.

| Configuración | Carrocería efectiva | Capacidad útil (peso y volumen) |
|---|---|---|
| Motriz sola (rígido, furgón, camioneta) | la de la motriz | la de la motriz |
| Tracto + semirremolque | la del semirremolque | la del semirremolque |
| Rígido + remolque | las dos: la configuración sirve para una carga si **alguna** de sus dos carrocerías es compatible | la suma de las unidades cuya carrocería es compatible con esa carga |
| Tracto solo | ninguna: no es una configuración que cargue | 0 |

Con un rígido y un remolque de carrocerías distintas, la carga solo puede ir en
la unidad que le sirve; por eso la capacidad cuenta solo esa. Si las dos sirven,
se suman.

Un vehículo sin carrocería declarada sigue la regla de la spec §3.5: elegible
solo para `carga_seca` y `otra`.

**Hoy esto no cambia ningún resultado en producción:** no hay unidades de
arrastre registradas (spec §2).

## 3. Cómo queda en el código (parte 1)

En `packages/matching-algorithm`, sin acceso a base ni a red:

- `COMPATIBILIDAD_CARGA_CARROCERIA`: un registro con los 11 tipos de carga y,
  por cada uno, las 10 carrocerías con `true` o `false`. El tipo exige las 110
  entradas: agregar un valor a cualquiera de los dos enums rompe la
  compilación hasta que se decida su fila o su columna.
- `carroceriaCompatible(tipoCarga, carroceria | null)`: lee la tabla; con
  carrocería nula aplica §3.5 de la spec.
- `configuracionesElegibles(carga, flota)` y `empresaEsCandidata(carga, flota)`:
  arman las configuraciones de §2 y aplican peso, volumen y carrocería (spec
  §3.3).

Tests (dominio crítico, con el rojo en la evidencia del PR):

- uno por cada uno de los 110 pares, generado desde una copia de la tabla
  escrita en el test, para que un cambio en la tabla tenga que hacerse en los
  dos lados;
- carrocería nula contra los 11 tipos;
- configuraciones: motriz sola, tracto con semirremolque, rígido con remolque
  de igual y de distinta carrocería, tracto solo;
- peso justo en el límite, y volumen declarado en uno solo de los dos lados.

Esta parte no toca el matching que corre en producción. Eso es la parte 2,
detrás de un flag y con comparación en sombra.

## 4. Decisiones del PO (2026-11-11)

1. La tabla de §1.1 queda aprobada completa, sin cambios.
2. Las dos reglas de §2 quedan aprobadas. Completan la spec §3.2, que las
   atribuía a ADR-073.

La tabla sigue sin validación contra una norma o una transportista (§1). Un
cambio posterior a un par se hace en la tabla y en su test, con el visto del
PO.

## 5. Efecto conocido sobre producción al activar la parte 2

Con la flota de hoy (16 vehículos, ninguno con carrocería declarada) y esta
tabla:

- los 16 viajes `carga_seca` conservan las mismas candidatas;
- el viaje `agricola` se queda sin candidatas hasta que alguna transportista
  declare carrocería. Es el riesgo que la spec ya recoge en §9.

## 6. Partes 4, 5 y 6 (un solo release)

Planificado 2026-11-13. Spec §6: se despliegan juntas. Migración 0079 ya
expandió `asignaciones.vehiculo_id` (opcional) y `vehiculos.es_de_tercero`.

### 6.1 Parte 4 — API / núcleo

1. `offer-actions.ts`: al aceptar, `vehicleId` = sugerido o `null` (no `''`).
2. `vehiculoDeAsignacion` tipado `string | null`; lectores pre-despacho con
   LEFT JOIN / contrato «por asignar» (inventario en `verify.md` parte 3).
3. `confirmar-recogida-viaje.ts`: rechaza sin vehículo o sin conductor (§3.8).
4. `PUT /rutas/:id/configuracion`: tests de criterio 4 (config no elegible,
   cambio post-recogida); la validación de carrocería/capacidad ya vive en
   `route-planner` / `matching-algorithm`.
5. Estimación sin vehículo: clase más chica elegible (§3.12), no
   `camion_mediano` fijo; al declarar, recalcula.
6. Flota: `carroceria` obligatoria al crear/editar; alta con `es_de_tercero`.

Rojo primero: integration aceptar sin vehículo; unit `offer-actions` (null);
recogida; estimación; rutas API.

### 6.2 Parte 5 — Recordatorios

Job (mismo estilo que recordatorios de cambio de carga): 24 h y 2 h antes del
inicio de la ventana → oficina; ventana iniciada sin vehículo → aviso al
generador. Idempotencia para no repetir.

### 6.3 Parte 6 — Web

- Oficina: declarar/cambiar en `/app/rutas`.
- Generador: «vehículo por asignar» hasta la declaración (no ve `es_de_tercero`).
- Flota: alta de unidad de tercero + carrocería obligatoria.

### 6.4 Fuera de este release (PO)

- Encender `RUTAS_API_ACTIVADA` y pasar matching a `activa`.
- Anexo de tipos de carga ADR-090.
