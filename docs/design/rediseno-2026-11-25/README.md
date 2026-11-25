# Traspaso — rediseño de Booster (2026-11-25)

**De:** la sesión de diseño (claude.ai, Project «Booster»).
**Para:** la sesión que implementa en este repositorio.
**Pedido del PO:** «necesito que las maquetas entren a producción».
**Autoridad:** `DESIGN.md` (raíz), en especial la sección 8.1 y la decisión D-18. Si una maqueta contradice a `DESIGN.md`, manda `DESIGN.md` y se avisa al PO.

## Qué hay en esta carpeta

| Ruta | Qué es |
|---|---|
| `maquetas/*.dc.html` | Las 56 pantallas. Cada archivo es HTML autónomo: se abre en el navegador con `file://` y solo pide la fuente Inter a Google Fonts. |
| `maquetas/canvas.json` | Título, ancho y alto de cada pantalla, y las notas del lienzo. |
| `capturas/*.jpg` | Una captura por maqueta, al ancho de su marco (1280 o 390 px), generada con Chrome sin interfaz el 2026-11-25. |
| `MAPA.md` | Cada maqueta con la ruta de la aplicación de la que parte, su tanda y lo que le falta para poder construirse. |

El lienzo vivo está en https://claude.ai/artifact/44QutQ6zQ25Tenyj1qoRNq. Esta carpeta es una copia de su versión `1795625245-b6c4`; si el lienzo cambia, la sesión de diseño vuelve a copiarla.

## Qué es una maqueta y qué no

- Es el objetivo visual y de contenido de una pantalla. No es código para pegar: usa estilos propios en línea, no los componentes de `packages/ui-components` ni los tokens de `packages/ui-tokens`.
- Los datos son inventados (nombres, patentes, direcciones, cifras). No sirven de fixture ni de texto fijo.
- Los mapas son dibujos. En el producto van los de Google Maps que la aplicación ya usa.
- Las pantallas de operador son un solo diseño fluido: bajo 640 px las columnas se apilan, las tablas se desplazan dentro de su caja y el menú superior pasa a una barra inferior. Las maquetas `Movil*` son los mismos diseños vistos a 390 px, no pantallas aparte.

## Decisiones del PO que las maquetas ya aplican

1. **Lema:** «Transporta más, impacta menos». Une dos servicios en una sola aplicación.
2. **Booster Spot** reemplaza a «Match de Carga». Cada carga es inmediata (retiro dentro de 24 horas desde la publicación, umbral configurable) o programada. No existe el contrato programado por empresa.
3. **Booster Fleet** se vende por separado. Con Booster Fleet solo, el menú es Inicio, Flota, Viajes propios y Empresa.
4. **Viaje propio:** huella y certificado de base, para que el transportista los entregue a sus clientes.
5. **Verde `primary-600`:** marca y acción principal en toda la plataforma. El dato ambiental se distingue por el sello «Medido» / «Estimado» (forma y palabra), no por el color (D-18).
6. **Montos (ADR-094):** el generador ve el total con IVA y dos facturas, la del transportista y la de Booster. El transportista ve solo lo que recibe, «+ IVA». El conductor no ve montos.
7. **Carta de porte** por viaje y **datos para la guía de despacho** (Resolución Exenta SII N.º 144 de 2026).
8. **Observatorio y datos agregados:** se muestran desde 1 camión; nunca empresa, patente, conductor ni un viaje individual.
9. **Pantallas fusionadas, aprobadas:** Cumplimiento, Seguimiento de flota, Trayectos y Zonas quedan dentro de las pantallas que muestra `MAPA.md`.
10. **Quién acepta una carga:** dueño, administrador y despachador. El conductor no.

## Lo que el repositorio ya tiene (según `docs/handoff/CURRENT.md`, sin comprobar en pantalla)

- **Servicios por empresa** (#1047): una empresa transportista puede quedar sin ofertas de carga y conservar Booster Fleet.
- **Interfaz propia de Booster Fleet** (#1049): marca, Inicio y menú con «Flota» y «Viajes propios» para esa empresa. La maqueta `TransportistaSoloFleet` parte de ahí, no de cero.
- **`/apariencia/*`**: rutas para ver el armazón y las primitivas sin sesión (por ejemplo `/apariencia/shell?rol=fleet`).

## Orden de entrega

Cada tanda es uno o más PR liberables por separado. El detalle por pantalla está en `MAPA.md`.

| Tanda | Qué entra | Depende de |
|---|---|---|
| 0 | Base: fusionar #1083 (botón verde y sello) y llevar el armazón al menú superior con barra inferior bajo 640 px | La decisión abierta de #1083 (ver «Preguntas abiertas») |
| 1 | Puerta de entrada y seguimiento público (5 pantallas) | Tanda 0 |
| 2 | Conductor (7 pantallas) | Tanda 0 |
| 3 | Transportista con Booster Fleet (11 pantallas) | Tanda 0; el ahorro de la ruta (pregunta abierta 4) |
| 4 | Generador (9 pantallas, sin lo de dinero) | Tanda 0 |
| 5 | Booster Spot y dinero (11 pantallas: montos, carta de porte y guía de despacho) | Frentes 3 a 9 de `.specs/comision-dentro-del-precio/spec.md` |
| 6 | Administración (13 pantallas) | Tanda 0; el panel de comisión depende del frente 7 |

Las tandas 1 a 4 y 6 son sobre todo presentación. La tanda 5 no puede salir antes que su código: muestra cifras que hoy la aplicación calcula de otra forma.

## Criterios de éxito por pantalla

1. A 1280 px y a 390 px la pantalla coincide con su captura en estructura, jerarquía, textos y estados. No se exige coincidencia al píxel.
2. Usa los componentes de `ui-components` y los tokens de `ui-tokens`. Ningún color fijo copiado de la maqueta.
3. Todo dato visible sale de la API. Si la API no lo entrega, la pantalla no lo inventa: o se construye el dato, o ese bloque queda fuera del PR y se anota.
4. Respeta la visibilidad: ninguna pantalla de transportista o conductor muestra el precio del viaje ni la comisión.
5. Pasa los tests de la ruta, el de accesibilidad con axe y el CI.
6. El PR adjunta captura del antes y del después con datos de prueba, no de producción.

## Lo que la sesión de diseño no comprobó

- **El mapa maqueta → ruta se hizo por nombre y propósito.** No se comparó cada maqueta con el código actual de su ruta. Antes de cada pantalla hay que leer las dos cosas y listar las diferencias.
- **No se revisaron en producción** la vista móvil, el seguimiento público, un viaje con camión en movimiento ni la voz. El PO dejó esa revisión para después.
- **Defectos conocidos de las maquetas:** el mapa de `MovilTransportistaOfertas` queda cortado a la derecha; la etiqueta del gráfico de combustible de `TransportistaVehiculo` sale deformada; los montos de `TransportistaCobraHoy` son de relleno.

## Preguntas abiertas para el PO

1. **Qué lleva el sello «Medido»** (pendiente desde #1083): la presentación «Distancia medida con Teltonika» de ADR-091 mide la distancia pero modela el consumo.
2. **Costo de «Cobra hoy»:** no está definido; la maqueta no puede mostrar cifras reales.
3. **Con o sin interruptor:** si el rediseño sale tanda por tanda a todos los usuarios, o detrás de un interruptor hasta completar un rol.
4. **Ahorro de la ruta:** el PO indicó que hay que construirlo y verificarlo después. Las bandas de «ruta ecoeficiente» de las maquetas dependen de ese cálculo. `packages/eco-routing/src/evaluar-alternativas.ts` ya habla de ahorro: falta revisar qué cubre y qué falta para mostrarlo en pantalla.

## Reparto entre sesiones

- **Implementación:** una sola sesión escribe código, en este repositorio.
- **Diseño:** la sesión de claude.ai corrige maquetas, mantiene los documentos y el contrato, y vuelve a copiar esta carpeta cuando el lienzo cambia. No toca `apps/` ni `packages/`.

## Documentos relacionados

- Revisión de la aplicación y propuesta: https://claude.ai/artifact/Ut69AoYAnVKzMrmsVbLQTm
- Investigación de QuadMinds: https://claude.ai/artifact/LfvbNNXAbNUBX5kTuUwF8K
- Carta de porte y condiciones generales: https://claude.ai/artifact/KVdfTiKkn1dsfijzXti14W
- Resolución Exenta SII N.º 144 de 2026: https://claude.ai/artifact/9r5C3o1gSG8jf1RSXT5N9h
- `docs/adr/094-comision-dentro-del-precio-del-generador.md` y `.specs/comision-dentro-del-precio/spec.md`
