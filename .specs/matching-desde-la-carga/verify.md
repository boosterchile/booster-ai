# Verificación: matching-desde-la-carga

## Parte 2 — elegibilidad detrás de un modo, con sombra (2026-11-11)

`MATCHING_ELEGIBILIDAD_MODO` decide qué regla elige a las candidatas:

| Modo | Quién decide las ofertas | Qué más hace |
|---|---|---|
| `vigente` (por defecto) | el matching de hoy: un vehículo activo con capacidad para el peso | nada; la elegibilidad por carga no corre |
| `sombra` | el matching de hoy | calcula la elegibilidad por carga al lado y registra la diferencia |
| `activa` | la elegibilidad por carga (carrocería, volumen, configuraciones con arrastre) | registra la misma comparación |

En sombra, si el cálculo nuevo falla, el matching sigue con la regla de hoy y
el error queda en el log. En `activa` un fallo hace fallar el matching: no
decide con la regla anterior en silencio.

La comparación queda en:

- el log `matching: elegibilidad por carga`, con el viaje, el tipo de carga,
  cuántas candidatas dio cada regla, y las empresas que solo aparecen en una o
  que cambian de vehículo sugerido;
- la métrica `matching_elegibilidad_comparaciones_total`, con `modo` y
  `resultado` (`coincide` o `difiere`).

### Cómo se activa

La variable no está declarada en Terraform: sin ella rige `vigente`. Pasar a
`sombra` es agregarla al servicio del api; pasar a `activa` es una activación
en producción. Las dos las hace el PO.

### Criterio 2 de la spec, con la flota y las cargas del 2026-11-10

Probado en `packages/matching-algorithm/test/elegibilidad-candidatas.test.ts`
con la flota activa (16 vehículos de 4 empresas, sin carrocería declarada) y
los 17 viajes, leídos de producción en solo lectura y sin identificadores.

| Carga | Resultado |
|---|---|
| Los 16 viajes `carga_seca` | mismas empresas que el matching de hoy |
| `carga_seca` de 22.000 kg y 100 m³ | misma empresa, **con aviso de volumen** |
| `agricola` de 10.000 kg | hoy se ofrece a dos empresas; con la regla nueva, a ninguna (spec §9) |

### El volumen: de descartar a avisar

La primera versión de la parte 2 (#918) aplicaba la regla original de la spec
§3.3: volumen útil ≥ volumen de la carga cuando los dos están declarados. Con
esa regla el viaje de 22.000 kg y 100 m³ quedaba sin candidatas, porque el
único vehículo que alcanza el peso declara 50 m³.

Los volúmenes declarados en la flota no son confiables (un camión de 10.000 kg
con 500 m³; uno de 28.000 kg con 50 m³). El PO decidió el 2026-11-11 que el
volumen **solo avise** (spec §11-5):

- no descarta ninguna configuración;
- entre las que sirven, se sugiere primero una sin aviso;
- la comparación del matching lista en `volumenInsuficiente` las empresas cuya
  configuración sugerida declara menos volumen que la carga. No cuenta como
  diferencia entre las dos reglas.

Se vuelve a evaluar cuando el dato de la flota esté corregido.

### Algo que la sombra dejó a la vista

El matching de hoy trata a una unidad de arrastre como si fuera un vehículo:
con un tracto y un semirremolque, sugiere el semirremolque en la oferta. En
producción no ocurre porque no hay unidades de arrastre registradas. La regla
nueva sugiere siempre la unidad motriz.

### Lo que no cubre

- No se corrió en sombra contra tráfico real: la variable no está activada.
- La comparación mira candidatas por flota. El puntaje y el orden entre
  candidatas no cambian en esta parte.
