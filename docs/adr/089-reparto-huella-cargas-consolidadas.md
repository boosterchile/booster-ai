# ADR-089 — La huella de una ruta se calcula una vez y se reparte por toneladas-kilómetro

**Estado**: Borrador para decisión del PO. Pasa a `Vigente` con su visto en el PR que lo mergea. No se mergea con decisiones abiertas (sección final).
**Fecha**: 2026-11-09
**Decider**: Felipe Vicencio (Product Owner).
**Acota a**:
- [ADR-021](./021-glec-v3-compliance.md), sección 3 (asignación del retorno vacío). Dentro de una ruta, los tramos vacíos se reparten con la regla de este ADR. Los factores de emisión y la corrección por carga de ADR-021 siguen vigentes.
- [ADR-077](./077-nivel-certificacion-por-fuente-de-posicion.md). El nivel de certificación se determina por ruta y lo heredan sus servicios. El resto sigue vigente.

Depende de [ADR-088](./088-ruta-parada-servicio.md). No supersede a ninguno.

**Spec**: por escribir (`.specs/huella-consolidada/spec.md`). Dominio crítico (GLEC): TDD con rojo exhibido.

**Aviso sobre las referencias normativas**: las reglas de GLEC Framework v3 e ISO 14083 citadas aquí están escritas de memoria y sin número de sección. La spec debe citarlas contra el texto antes de implementar, y el método debe pasar por la verificación externa de `docs/compliance/glec-rfp.md`.

---

## Contexto

`calcular-metricas-viaje.ts` calcula la huella de cada viaje con el vehículo de su asignación, la distancia del viaje y el peso de esa carga (`viajes.peso_carga_kg`), y guarda el resultado en `metricas_viaje`, una fila por viaje. El retorno vacío se imputa a cada envío con un factor de matching (`packages/carbon-calculator/src/glec/empty-backhaul.ts`).

Eso es correcto mientras un camión lleva una carga. Con varias cargas en el mismo camión falla de dos maneras:

- Cada carga se calcula como si el camión fuera solo para ella: los mismos kilómetros y el mismo combustible se cuentan una vez por carga. La suma de los certificados supera lo que el camión emitió.
- La corrección por carga usa el peso de una sola carga contra la capacidad del vehículo, cuando la masa real a bordo es la suma de todas.

Un certificado que suma más que la emisión real no resiste una verificación, y es el atributo comercial del producto.

## Decisión

1. **Se calcula la ruta, no el servicio.** La emisión de la ruta, `E`, es una sola cifra: la suma de sus tramos (ADR-088), cargados y vacíos. Con combustible medido por CAN, `E` sale del combustible consumido en la ruta. Sin él, cada tramo se modela con la masa total a bordo en ese tramo.

2. **Se reparte por actividad de transporte.** La actividad del servicio `i` es `a_i = masa_i × d_i`, donde `d_i` es la distancia directa entre el origen y el destino de ese servicio (la ruta más corta factible), no los kilómetros que el camión recorrió con esa carga a bordo. La parte del servicio es:

   `E_i = E × a_i / Σ a_j`

   Se usa la distancia directa para que el resultado no dependa del orden de reparto: quien queda último en el recorrido no paga los desvíos hechos para los demás.

3. **Los tramos vacíos de la ruta se reparten igual.** Están dentro de `E`, así que cada servicio recibe su parte en la misma proporción. El factor de matching por envío de ADR-021 deja de aplicarse a los tramos que están dentro de la ruta.

4. **Invariante: los certificados suman exactamente la ruta.** `Σ E_i = E`. El redondeo se hace con resto mayor, de modo que la suma de los valores publicados coincida con el total publicado. Va con test de propiedad sobre rutas generadas. La suma nunca supera `E`.

5. **Un servicio que viaja solo da lo mismo que hoy.** Una ruta de dos paradas reparte el 100 % a su único servicio. Va con test de regresión contra los certificados ya emitidos.

6. **Masa.** Se usa el peso declarado del servicio. La regla vigente para un servicio sin peso declarado no cambia y se aplica a ese servicio; su ausencia no bloquea el certificado de los demás, que se reparten entre sí el total. (Ver decisión abierta 2.)

7. **Nivel de certificación.** Se determina una vez por ruta, con la fuente y la cobertura de la ruta completa (ADR-077), y todos sus servicios lo heredan.

8. **Cuándo se emite.** El certificado de un servicio se emite cuando su ruta se cierra, porque `E` y `Σ a_j` no se conocen antes. Hasta entonces el generador ve la estimación. (Ver decisión abierta 1.)

9. **Qué dice el certificado.** Agrega: que la carga viajó consolidada, el método de reparto («toneladas-kilómetro, distancia directa»), la participación del servicio en la ruta en porcentaje, y la versión del método. No identifica a los otros generadores.

10. **A quién corresponde cada cifra.** La empresa transportista informa el 100 % de `E` como emisión propia (directa por la combustión; la parte de producción del combustible va aparte). Cada generador informa su `E_i` como emisión indirecta de transporte contratado. La clasificación exacta por alcance y categoría de GHG Protocol se fija en la spec, citada.

11. **Persistencia.** Tabla nueva `metricas_ruta` con `E`, su desglose, la fuente y el nivel. `metricas_viaje` conserva la cifra de cada servicio y agrega `ruta_id`, la actividad `a_i` y la participación. El cálculo de reparto vive en `packages/carbon-calculator` como función pura.

## Consecuencias

- La suma de lo certificado a los generadores de una ruta es igual a lo que la transportista informa por esa ruta. Es verificable por un tercero con dos consultas.
- La intensidad (g CO₂e por tonelada-kilómetro) es la misma para todos los servicios de una ruta. Es una propiedad del método, no un error.
- Una carga consolidada recibe menos emisión que la misma carga viajando sola. Ese es el beneficio medible de consolidar.
- El certificado de un servicio consolidado tarda más: espera el cierre de la ruta.
- El ahorro «frente a haber viajado solo» se puede mostrar como comparación informativa. No es una cifra certificada.

## Alternativas descartadas

- **Repartir por los kilómetros reales con la carga a bordo.** Depende del orden de las paradas y castiga a la última entrega.
- **Repartir por peso, sin distancia.** Una carga que baja a los 20 km paga lo mismo que una que sigue 400.
- **Repartir por precio.** No tiene base física y no es defendible ante un verificador.
- **Seguir calculando por servicio y corregir después.** Mantiene dos cálculos que deben coincidir y no coinciden.

## Decisiones abiertas para el PO

| # | Pregunta | Recomendación |
|---|---|---|
| 1 | ¿Certificado al cerrar la ruta, o uno provisional al entregar cada servicio? | Solo al cerrar la ruta. Un provisional que después cambia debilita el documento. |
| 2 | Un servicio sin peso declarado dentro de una ruta consolidada. | Exigir peso para consolidar: sin peso el servicio no entra en una ruta con otros. Evita certificados parciales. |
| 3 | ¿Cargas livianas y voluminosas se reparten por volumen o pallets? | No en la primera versión. Toneladas-kilómetro para todos, y revisar con datos reales. |
| 4 | El posicionamiento antes de la primera recogida y el regreso después de la última entrega, ¿son parte de la ruta? | Sí cuando hay telemetría que los mide. Sin ella, se mantiene el factor de ADR-021 sobre el total de la ruta. |
