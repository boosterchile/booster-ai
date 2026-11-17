# Booster Fleet — que los 7 días sean 7 días

**Estado**: borrador, espera la aceptación del PO · **Fecha**: 2026-11-17 · **Pedido**: PO

Depende de [`.specs/booster-fleet/spec.md`](../booster-fleet/spec.md) y de
[`.specs/booster-fleet-rediseno/spec.md`](../booster-fleet-rediseno/spec.md).
No cambia ninguna regla de combustible: cambia cuánta telemetría alcanza a
leer el panel.

## 1. El problema

Booster Fleet dice «últimos 7 días». El panel lee la telemetría con
`leerTrayectosDeLaFlota`, que trae como máximo **20.000 puntos por
consulta** (`MAX_PUNTOS_TRAYECTO`) y se queda con los más recientes de toda
la flota.

Medido en producción el 2026-11-17, en solo lectura:

| Flota | Camiones con puntos | Puntos en 7 días | Veces el tope |
|---|---|---|---|
| La más grande | 8 | 198.582 | 9,9 |
| La otra con telemetría | 2 | 23.227 | 1,2 |

Las dos flotas que hoy envían telemetría superan el tope. Con el código de
`main` y los puntos reales de la flota más grande, el panel leyó **6,4
horas**: el punto más antiguo que entró era del mismo día a las 11:45, hora
de Santiago. Los litros, los kilómetros y el L/100 km que mostraría son de
esa mañana.

Tres consecuencias:

- La cifra de consumo de la flota y la de cada camión no son de la semana.
- Una desviación de hace dos días no aparece: sus puntos quedaron fuera.
- El corte es global y por fecha. Un camión que reporta más seguido ocupa
  más del tope y deja a los demás con menos historia.

El panel lo declara (`combustible.truncado = true` y el aviso de telemetría
cortada), pero no dice desde cuándo son los datos. Booster promete medir de
verdad: una cifra que dice «7 días» y cubre seis horas no cumple eso.

Dato para dimensionar: un camión genera unos 25.000 puntos por semana, y el
`io_data` de cada punto pesa unos 600 bytes.

## 2. Entradas

- `telemetria_puntos` de los vehículos con Teltonika de la empresa, en la
  ventana del panel.
- La configuración de cada vehículo (capacidad de estanque, fuente de
  combustible) y los umbrales de la empresa, como hoy.
- Redis, que ya es parte del stack.

## 3. Salidas

### 3.1 Lectura completa de la ventana

El panel y el detalle del vehículo leen los 7 días completos de cada camión,
hasta un presupuesto explícito (§4.2).

Para que eso quepa en una consulta, la lectura:

1. **Trae solo lo que el segmentador usa.** Hoy viaja el `io_data` entero;
   el segmentador lee un puñado de AVL. La consulta proyecta esas claves y
   deja el resto en la base.
2. **Lee por vehículo.** Cada camión trae su ventana completa. El corte
   deja de ser global.
3. **Guarda el resultado.** La lectura de combustible de la flota se guarda
   en Redis por un tiempo corto (§4.3). Documentos y mantenciones se siguen
   leyendo en vivo.

### 3.2 Cuando no alcanza, se dice desde cuándo

Si una flota supera el presupuesto, el panel sigue respondiendo y declara
el recorte con precisión:

- el recorte es **por vehículo**: cada camión conserva sus puntos más
  recientes en partes iguales, en vez de que unos pocos ocupen todo;
- la respuesta agrega `combustible.cobertura_desde`: el instante del punto
  más antiguo que se leyó. Es un campo nuevo, opcional, que no cambia los
  existentes;
- la pantalla reemplaza el aviso genérico por uno que dice desde cuándo son
  las cifras.

Con la ventana completa, `truncado` es falso y `cobertura_desde` no viene.

### 3.3 Lo que se mide

- Métrica de negocio con los puntos leídos por consulta, la duración de la
  lectura y si salió de caché.
- Un registro de advertencia cuando una flota supera el presupuesto, con el
  identificador de la empresa y cuántos puntos tenía.

## 4. Reglas

### 4.1 Qué claves se proyectan

La lista de AVL que el segmentador lee vive junto al segmentador, como una
constante exportada. La consulta la usa para proyectar. Un test falla si el
segmentador lee un AVL que no está en esa lista: así la proyección no puede
quedarse corta en silencio.

El resultado del segmentador con la proyección tiene que ser idéntico al
que da con el `io_data` entero.

### 4.2 Presupuesto

- **400.000 puntos por consulta de panel.** Cubre 16 camiones con 7 días
  completos, al ritmo medido. La flota más grande de hoy usa la mitad.
- Sobre el presupuesto se aplica §3.2. El tope deja de ser una constante
  suelta: es configuración, con ese valor por defecto.
- El detalle de un vehículo lee sus 7 días completos; un camión no llega al
  presupuesto.

### 4.3 Caché

- Se guarda la lectura de combustible por empresa, **10 minutos**.
- La clave incluye la empresa y el tramo de 10 minutos en que cae la
  consulta, para que dos pestañas vean lo mismo.
- No se guarda ningún dato de documentos ni de mantenciones.
- Si Redis no responde, el panel lee de la base y lo registra: la caché no
  es requisito para responder.
- Un cambio de capacidad de estanque, de fuente de combustible o de
  umbrales se refleja, a más tardar, al vencer esos 10 minutos.

### 4.4 Tiempos

- Con la flota más grande de hoy (8 camiones, 200.000 puntos): la primera
  lectura responde en menos de 4 segundos y la que sale de caché en menos
  de 300 ms. Se miden con datos sintéticos del mismo volumen.
- Si la primera lectura no cumple, se detiene el trabajo y se escala con la
  medición: no se sube el tiempo permitido por criterio propio.

### 4.5 Lo que no cambia

- Ninguna regla de detección, ningún umbral, ningún cálculo de consumo.
- El listado de trayectos de 30 días (`/app/trayectos`) sigue con su lectura
  actual. Tiene el mismo tope y se trata aparte.
- El esquema de la base. No hay migración.

## 5. Criterios de éxito

1. Con una flota de 8 camiones y 200.000 puntos en 7 días, el panel responde
   con `truncado = false` y sus cifras incluyen trayectos de hace más de
   seis días.
2. Una desviación ocurrida cinco días atrás aparece en el panel de esa
   flota.
3. El segmentador da el mismo resultado con la proyección que con el
   `io_data` entero, sobre los casos de sus tests.
4. Un test falla si el segmentador lee un AVL que la proyección no trae.
5. Con una flota que supera el presupuesto, cada camión conserva historia,
   `truncado` es verdadero y `cobertura_desde` trae el instante del punto
   más antiguo leído.
6. La pantalla, cuando hay recorte, dice desde cuándo son las cifras.
7. Dos consultas de la misma empresa dentro del mismo tramo de 10 minutos
   leen la telemetría una sola vez.
8. Con Redis caído, el panel responde y deja un registro.
9. Se cumplen los tiempos de §4.4, medidos y adjuntos en la Evidencia.
10. Los criterios de las dos specs de las que depende siguen pasando.

## 6. Lo que no entra

- Guardar los trayectos ya segmentados en una tabla (§7.2).
- El listado de trayectos de 30 días.
- Cambiar la frecuencia con que los equipos reportan.
- Configurar la fuente de combustible o la capacidad de estanque de los
  camiones que hoy figuran sin sensor aunque envían datos: es configuración
  de cada vehículo, no de esta spec.

## 7. Para decidir (PO)

1. Aceptar esta spec, con o sin cambios.
2. **El camino.** Esta spec propone leer más y mejor en cada consulta, con
   caché. Resuelve las flotas de hoy sin tocar el esquema. Su límite es
   lineal: sobre unos 16 camiones vuelve a recortar, ahora de forma pareja y
   declarada. La alternativa es guardar los trayectos ya segmentados en una
   tabla que un proceso mantiene al día, y que el panel lea de ahí. Escala
   sin límite práctico, pero pide una tabla nueva, un proceso programado y
   reglas para recalcular cuando cambia la configuración de un camión.
   Recomendación: este camino ahora, y la tabla cuando una flota se acerque
   al presupuesto.
3. Los números: presupuesto de 400.000 puntos, caché de 10 minutos y los
   tiempos de §4.4.
4. El campo nuevo `combustible.cobertura_desde` en la respuesta del panel.
