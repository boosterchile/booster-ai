# Plan: ruta-parada-servicio, parte 5 (API del transportista)

- **Spec**: [spec.md](./spec.md) (aceptada el 2026-11-10)
- **Date**: 2026-11-11
- **Status**: Aprobado por el PO en el chat del 2026-11-11 («Apruebo todo»): el contrato de §3, las decisiones D1 a D5 de §4 con la recomendación de cada una, y la entrega en tres PRs de §5.

La spec §5 pide fijar aquí los nombres de las rutas y los campos de la API antes
del PR que los introduce. Este plan cubre la parte 5. Las partes 6 a 8 se
planifican cuando esta esté en main.

## 1. Lo que encontré en main que cambia el alcance

Leído en `main` @ `197af3ce`.

1. **La ruta solo se pone al día si tiene un servicio.**
   - `conciliarRuta` (`services/sincronizar-ruta-de-asignacion.ts`) copia la
     asignación a la ruta, y si la ruta tiene más de dos paradas devuelve
     `omitida` y no hace nada.
   - Con una ruta de varios servicios, confirmar una recogida o una entrega,
     cancelar una carga o cambiar el conductor no resuelven la parada ni
     mueven el estado de la ruta.
   - Hoy no pasa porque ninguna ruta tiene varios servicios: la API de esta
     parte es la que los crea.
2. **El vehículo y el conductor se escriben en la asignación** y se copian a la
   ruta (`asignarConductorAAssignment`). Si la API los declara en la ruta, la
   próxima sincronización los pisa con los de la asignación.
3. **Un cambio de peso después del match** (`aceptarSolicitudCambio`) compara
   solo contra la capacidad de la motriz, sin tramos ni arrastre. En una ruta
   con varios servicios puede romper el invariante 2 de §4.4 sin que nadie lo
   vea.
4. **El paquete `route-planner` no tiene todo lo que la API necesita:**
   - no puede mover un servicio entre dos rutas;
   - no arma la ruta propia de dos paradas;
   - no declara el conductor por separado del vehículo;
   - no conoce los ids.
5. **La capacidad útil de motriz más arrastre** está en `matching-algorithm`
   (`capacidadUtil`, `unidadesQueCargan`), pero sin exportar y atada a una sola
   carga.

Por eso la parte 5 son tres PRs (§5), y solo el último cambia contratos.

## 2. La API sale apagada

La spec §7 dice que las partes 5, 6 y 7 se despliegan juntas, y §11-1 que la
consolidación sale con el reparto de huella. El release sale de `main`, así que
la API entra detrás de `RUTAS_API_ACTIVADA` (`booleanFlag(false)`):

- apagada, todas las rutas bajo `/rutas` responden 404 `not_found`;
- se enciende con la parte 4 de la huella y las partes 6 y 7 en `main`. Es una
  activación en producción y la decide el PO.

## 3. Contrato propuesto

Bajo `/rutas`, con los mismos middlewares que `/assignments`: autenticación,
contexto de usuario, guardia de escritura en impersonación y guardia de
visibilidad del transportista. Todo se filtra por la empresa activa: una ruta
de otra empresa responde 404, igual que una que no existe.

Para leer basta ser miembro de la empresa, igual que la lista de asignaciones
(visualizador incluido). Para escribir hace falta `puedeAsignarViaje` (dueño,
admin o despachador). El conductor recibe 403 `capability_denied`: su hoja de
ruta es la parte 6 y va por `/me`.

### 3.1 Leer

**`GET /rutas?estado=planificada,en_curso`**: rutas de la empresa, las más
recientes primero. Por defecto, `planificada` y `en_curso`.

```json
{
  "rutas": [
    {
      "id": "uuid",
      "estado": "planificada",
      "vehiculo": { "id": "uuid", "patente": "ABCD12" },
      "unidad_arrastre": null,
      "conductor": { "id": "uuid", "nombre": "Juan Pérez" },
      "servicios": 3,
      "paradas_pendientes": 6,
      "creada_en": "2026-11-11T12:00:00Z"
    }
  ]
}
```

**`GET /rutas/:id`**: la ruta con sus paradas en orden y la carga a bordo de
cada tramo.

```json
{
  "ruta": {
    "id": "uuid",
    "estado": "planificada",
    "vehiculo": { "id": "uuid", "patente": "ABCD12" },
    "unidad_arrastre": null,
    "conductor": { "id": "uuid", "nombre": "Juan Pérez" },
    "capacidad": { "kg": 28000, "m3": 90 },
    "paradas": [
      {
        "id": "uuid",
        "orden": 0,
        "tipo": "recogida",
        "resuelta_en": null,
        "servicio": {
          "asignacion_id": "uuid",
          "viaje_id": "uuid",
          "codigo_seguimiento": "BOO-ABC123",
          "direccion": "texto de la dirección de recogida",
          "ventana": { "desde": "…", "hasta": "…" },
          "peso_kg": 8000,
          "volumen_m3": null
        }
      }
    ],
    "tramos": [
      { "desde": 0, "hasta": 1, "masa_kg": 8000, "volumen_m3": null, "vacio": false }
    ],
    "avisos": []
  }
}
```

`avisos` lleva los avisos que no bloquean, por ejemplo el de volumen si se
decide así (§4, D2).

### 3.2 Escribir

| Operación | Ruta | Cuerpo |
|---|---|---|
| Agrupar: mover un servicio a esta ruta | `POST /rutas/:id/servicios` | `{ "asignacion_id": "uuid", "posicion": { "recogida": 2, "entrega": 4 } }` |
| Quitar un servicio | `DELETE /rutas/:id/servicios/:asignacion_id` | sin cuerpo |
| Reordenar paradas | `PUT /rutas/:id/paradas` | `{ "paradas": ["id", "id", …] }` (todas las paradas, en el orden nuevo) |
| Declarar vehículo, arrastre y conductor | `PUT /rutas/:id/configuracion` | `{ "vehiculo_id": "uuid", "unidad_arrastre_id": null, "conductor_id": "uuid" }` |

- Las cuatro responden con la ruta completa, con la misma forma que
  `GET /rutas/:id`.
- **Agrupar** mueve la asignación desde su ruta actual. Si esa ruta queda sin
  servicios, pasa a `cancelada` (spec §4.2). `posicion.recogida` es el índice
  de la parada de recogida en la ruta actual. `posicion.entrega` es el índice
  de la entrega con la recogida ya insertada.
- **Quitar** responde además `ruta_nueva_id`: el servicio vuelve a una ruta
  propia de dos paradas, `planificada` (spec §4.5).
- **Reordenar** recibe ids y no índices, para que un cambio concurrente no
  reordene otra cosa.
- Cada operación deja su evento en `eventos_ruta`:
  - `servicio_agregado` y `servicio_quitado`, con `{ viaje_id, asignacion_id }`
    y la ruta de origen o de destino;
  - `paradas_reordenadas`, con el orden anterior y el nuevo;
  - `configuracion_declarada`, con los tres ids y `origen: "api"`.

### 3.3 Errores

| Status | `code` | Cuándo |
|---|---|---|
| 404 | `ruta_not_found` | no existe, es de otra empresa o la API está apagada |
| 404 | `asignacion_not_found` | la asignación no es de la empresa |
| 403 | `capability_denied` | el rol no puede escribir |
| 409 | `ruta_cambio_concurrente` | la ruta cambió entre la lectura y la escritura |
| 422 | `ruta_invalida` | la operación rompe una regla de §4.4 o §4.5 |

Un 422 detalla qué regla rompe y dónde. Si es de capacidad, trae las cifras del
tramo:

```json
{
  "error": "ruta_invalida",
  "code": "ruta_invalida",
  "violaciones": [
    { "motivo": "capacidad_peso_excedida", "tramo": 2, "masa_kg": 31000, "capacidad_kg": 28000 }
  ]
}
```

Los `motivo` son los de `route-planner` (`MOTIVOS_RECHAZO`). Cada endpoint abre
un span `rutas.<operacion>` y suma 1 a `rutas_operaciones_total`, con
`{ operacion, resultado }`.

## 4. Decisiones del PO

| # | Pregunta | Decisión (aprobada como se recomendó) |
|---|---|---|
| D1 | Con la ruta `en_curso`, ¿se puede cambiar el conductor (relevo)? | **Sí, solo el conductor.** El vehículo no, porque cambiarlo con carga a bordo es un transbordo y queda fuera de la spec (§8). Hoy `asignar-conductor` ya permite el relevo con la carga recogida, y quitarlo rompería la operación. |
| D2 | ¿El volumen rechaza o solo avisa al armar la ruta? | **Solo avisa**, igual que la decisión §11-5 de matching del 2026-11-11: los volúmenes de la flota no son confiables. El peso sí rechaza. El aviso va en `avisos` y no bloquea. |
| D3 | ¿Cuánta capacidad tiene una motriz con arrastre en una ruta con cargas de distinto tipo? | **La suma de las unidades que cargan** (tracto con semirremolque: el semirremolque; rígido con remolque: los dos). Además, cada servicio tiene que caber en carrocería en al menos una de esas unidades, con la tabla aprobada en #915. Con un rígido y un remolque de carrocerías distintas, esta suma puede sobrestimar. Hoy no hay unidades de arrastre registradas; se revisa cuando las haya. |
| D4 | Un servicio quitado vuelve a su ruta propia: ¿con qué vehículo y conductor? | **Con los de la ruta de la que sale.** Un servicio que ya cupo en ese camión cabe solo. Dejarlo sin vehículo depende de la parte 4 de matching (aceptar sin vehículo), que aún no está. |
| D5 | ¿Hay que confirmar las paradas en orden? | **No.** Confirmar la recogida o la entrega de un servicio resuelve su parada aunque no sea la siguiente: la operación real manda y no se bloquea al conductor. La regla de §4.5 («agregar solo después de la última parada resuelta») toma la última resuelta en el orden de la ruta. |

## 5. Entrega en tres PRs

| PR | Qué entra | Visto del PO |
|---|---|---|
| 5a | `route-planner`: mover un servicio entre dos rutas; armar la ruta de dos paradas; declarar solo el conductor (D1); el volumen como aviso (D2); la capacidad de la configuración (D3) exportada desde `matching-algorithm` y usada por el paquete; motivos con las cifras del tramo. Paquete puro, con tests de propiedad. | no |
| 5b | La ruta como fuente de verdad en las rutas de varios servicios: confirmar la recogida y la entrega resuelven la parada y mueven el estado con `estadoQueCorresponde` (D5); cancelar una carga la saca de la ruta; `asignar-conductor` declara en la ruta; un cambio de peso se valida contra la ruta. Para una ruta de un servicio no cambia nada (criterio 7 de la spec), y lo comprueba un test de regresión. | no |
| 5c | Los endpoints de §3, detrás de `RUTAS_API_ACTIVADA`, con los tests del criterio 5 de la spec: agrupar, quitar y reordenar respetan §4.5 en `planificada` y `en_curso`, y una empresa no opera rutas de otra. | **sí: API** |

5a y 5b no cambian nada para los usuarios mientras no existan rutas de varios
servicios, y solo la 5c puede crearlas. Las tres son dominio crítico: primero el
test, con el rojo en la evidencia del PR.

## 6. Fuera de esta parte

- La hoja de ruta del conductor, la web del transportista (parte 6) y el
  seguimiento con paradas (parte 7).
- El reparto de la huella entre los servicios de la ruta (huella consolidada,
  parte 4).
- Anular una ruta con servicios. Se hace quitándolos uno a uno; la ruta vacía
  pasa sola a `cancelada`.
- Transbordo, optimización del orden y sugerencias de agrupación (spec §8).
