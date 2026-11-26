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
| `FRENTES.md` | El plan: los diez frentes del rediseño, con sus criterios de término. |
| `MAPA.md` | Cada maqueta con la ruta de la que parte, sus frentes y lo verificado en el código. |

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

## Decisiones del PO del 2026-11-25 sobre lo verificado

Responden a las contradicciones de «Verificado contra el código». Prevalecen sobre las specs anteriores en lo que contradigan.

1. **Navegación: menú superior, como las maquetas**, con barra inferior bajo 640 px. Reemplaza la barra lateral de `.specs/d2-operador-shell-sidebar/`; el cambio de armazón necesita su propia spec. Las entradas actuales quedan donde las maquetas las ponen: Seguimiento de flota, Vehículos, Trayectos y Cumplimiento dentro de Flota y del detalle de vehículo; Servicios y Rutas en Viajes, con Liquidaciones («Pagos») y Cobra hoy como pestañas; Zonas y Equipo en Empresa; Conductores conserva su pantalla, a la que se llega desde Flota. Dispositivos son los equipos Teltonika que se instalan y se asignan a un camión (precisión del PO): van en Flota, en el detalle de cada vehículo.
2. **Sello «Medido»: se refiere a la huella de carbono.** Va solo cuando la huella misma fue medida (`primario_verificable`). La presentación intermedia de ADR-091 conserva su texto («Distancia medida con Teltonika · consumo modelado») y no lleva «Medido». Lo demás es «Estimado». Son tres presentaciones en pantalla, igual que en el certificado.
3. **El generador tiene dos caminos para asignar:** elegir un transportista, o subir su requerimiento para que los transportistas ofrezcan su servicio. `GeneradorElegir` se construye. Es un cambio del modelo de asignación (hoy queda asignado el transportista que acepta primero). Está decidido en `docs/adr/095-asignacion-el-generador-elige.md` (vigente desde el 2026-11-25); falta su spec.
4. **Cada pantalla sale a todos los usuarios al liberarse.** Sin interruptor por rol. No cambia `PRICING_V3_ACTIVATED`, que sigue apagado hasta cerrar los frentes 3, 4 y 5 de la comisión.

## Plan de trabajo

El plan son los **diez frentes** de `FRENTES.md`, no un orden por rol. Cada frente tiene su criterio «Hecho cuando». El orden recomendado: 1 y la parte de componentes del 8; después 2 y 3; el 5 antes del 6 y el 7; 4 y 10 juntos; el 9 en paralelo.

Lo que depende de la comisión (montos, carta de porte, guía de despacho, tipo de carga) no sale antes que los frentes 3 a 9 de `.specs/comision-dentro-del-precio/spec.md`.

**Regla para no rehacer lo hecho:** varias pantallas ya fueron rediseñadas con specs aceptadas por el PO (lista en «Verificado contra el código»). La maqueta se aplica como diferencia sobre esa pantalla, no como reemplazo. Si la maqueta contradice una spec aceptada, se le pregunta al PO antes de construir.

## Verificado contra el código (`main` en `3c9881c`, 2026-11-25)

Lectura de `apps/web/src`, `apps/api/src`, `packages/` y `.specs/`. No se ejecutó la aplicación.

### Contradicciones entre maquetas y lo ya decidido (resueltas el 2026-11-25)

1. **Navegación.** La aplicación tiene barra lateral persistente y cajón en móvil (`components/Layout.tsx`, `Sidebar.tsx`, `nav-items.ts`), decidida en `.specs/d2-operador-shell-sidebar/` (aceptada, goal del PO del 2026-07-09). Las maquetas dibujan menú superior y barra inferior bajo 640 px. El apartado «Estado actual» de `DESIGN.md` dice «sin sidebar» y está desactualizado. **Resuelto:** menú superior (decisión 1 de arriba).
2. **Cantidad de entradas del menú.** `navSectionsForMe` arma para un transportista administrador con ofertas y finanzas unas 16 entradas (3 o 4 generales y 12 o 13 bajo «Transporte»); la maqueta propone 5 (Inicio, Flota, Viajes, Ofertas, Empresa) y 4 con Booster Fleet solo. El PO aprobó fusionar Cumplimiento, Seguimiento de flota, Trayectos y Zonas; **Resuelto** (decisión 1).
3. **`GeneradorElegir` no corresponde al modelo actual.** Hoy el generador no elige: el matching envía ofertas y el transportista que acepta queda asignado (`apps/api/src/services/offer-actions.ts`; el detalle de la carga solo muestra «Hay N transportistas evaluando»). Construir esa pantalla es cambiar el modelo de asignación, no la interfaz. **Resuelto:** se construye, con ADR y spec previos (decisión 3).
4. **El sello tiene tres presentaciones, no dos.** ADR-091 (PO, 2026-11-12) fija Primario, «Distancia medida con Teltonika · consumo modelado» y Estimado, y dice que «medida» aplica solo a la distancia. Las maquetas dibujan dos estados. El PO precisó el 2026-11-25 que «Medido» se refiere a la huella de carbono. **Resuelto:** el PO confirmó que «Medido» va solo cuando la huella misma fue medida (decisión 2).

### Lo que las maquetas muestran y el código no hace

5. **El viaje propio con cliente externo no emite certificado.** `crear-viaje-propio.ts` deja `generadorCargaEmpresaId` en nulo para un cliente externo y `emitir-certificado-viaje.ts` se salta el viaje con motivo `no_shipper`. `TransportistaViajePropioEntregado` depende de construir eso.
6. **El ahorro de la ruta no existe para planificar.** `apps/api/src/services/eco-route-preview.ts` entrega distancia, duración, litros y huella estimada de una oferta, sin comparar con otra ruta (su propio comentario deja el diferencial «para una iteración futura»). `packages/eco-routing/src/evaluar-alternativas.ts` sí calcula ahorro en segundos y en kg CO₂e, pero solo para sugerir una ruta alternativa durante un viaje con congestión, y detrás de `ECO_ROUTING_REALTIME_ACTIVATED` (apagado). Falta el ahorro en litros y CO₂e frente a la ruta más rápida al publicar, al ver una oferta y al crear un viaje propio. La base para construirlo existe: `routes-api.ts` ya pide consumo de combustible a Routes API.
7. **Umbrales de anonimato.** El observatorio exige 10 vehículos (`K_MIN_VEHICULOS` en `services/observatorio/proyeccion.ts`, con un test que lo fija) y los agregados de organizaciones exigen 5 (`K_ANON` en `services/stakeholder-aggregations.ts`). El PO decidió 1.
8. **Carta de porte.** Nada en `main`. Hay dos ramas de mayo de 2026 (`feat/carta-porte-generator` y `-mvp`), con un paquete generador de PDF, a 1.085 commits de `main`. Sirven de referencia, no de base.
9. **Chat.** `components/chat/ChatPanel.tsx` es texto libre con foto. Las maquetas proponen mensajes cortos predefinidos.
10. **Conductor.** Existen el panel de incidente (`components/inicio/incidente-panel.tsx`), los documentos del viaje (`components/conductor/DocumentosViajeConductor.tsx`), el resultado del viaje (`ResultadoViaje.tsx`) y el retiro con geocerca. No existen la elección de tamaño de letra, color y contraste, la evidencia de entrega con foto y receptor, ni la entrega condicionada a estar detenido en el destino.
11. **Repetir una carga:** no existe.

### Mapas

Todos los mapas son de Google Maps con `@vis.gl/react-google-maps`. No hay un componente común: hay seis en `components/map/` más `components/offers/EcoRouteMapPreview.tsx`.

| Componente | Lo usan |
|---|---|
| `LiveTrackingScreen` | seguimiento de la carga, detalle de la asignación, vehículo en vivo, tarjeta de mapa del Inicio del generador |
| `FleetMap` | seguimiento de flota, mini mapa del Inicio del transportista, flota de la plataforma |
| `VehicleMap` | detalle de la carga, chat, ficha del vehículo; base de `FleetMap` y de `EcoRouteMapPreview` |
| `EcoRouteMapPreview` | tarjeta de oferta, tarjeta de ruta de la asignación, pantalla del conductor |
| `TrazaMapPreview` | ficha e historial del vehículo, tarjeta de traza de la carga |
| `EventoCombustibleMap` | detalle de vehículo de Booster Fleet, trayectos |

`viaje-propio-nuevo.tsx` y la publicación de una carga no se revisaron para saber si ya muestran la ruta. El frente 8 pide un componente común con un mismo trazo y los mismos marcadores.

### Specs aceptadas que ya rediseñaron pantallas con maqueta

| Pantalla | Spec | Aceptada |
|---|---|---|
| Armazón del operador | `d2-operador-shell-sidebar` | 2026-07-09 |
| Conductor: tarjeta guiada, ruta y resultado | `conductor-tarjeta-guiada`, `conductor-vista-ruta-resultado`, `ui-conductor-operativa` | 2026-08 a 2026-09 |
| Inicio del conductor, del generador, del transportista y mixto | `inicio-conductor`, `inicio-generador`, `inicio-transportista`, `inicio-negocio-hoy`, `inicio-mixta` | 2026-10-19 |
| Seguimiento en vivo | `tracking-live-unificado` | 2026-09-20 |
| Documentos del viaje | `gestor-documental-viaje` | 2026-09-21 |
| Servicios del transportista | `servicios-del-transportista` | 2026-08-03 |
| Viaje propio | `viaje-propio-transportista` | 2026-11-16 |
| Booster Fleet: panel por severidad y detalle sobre eje de tiempo | `booster-fleet-rediseno`, `booster-fleet-ventana-completa` | 2026-11-17 |
| Booster Fleet como producto propio | `booster-fleet-interfaz` | 2026-11-23 |

## Criterios de éxito por pantalla

1. A 1280 px y a 390 px la pantalla coincide con su captura en estructura, jerarquía, textos y estados. No se exige coincidencia al píxel.
2. Usa los componentes de `ui-components` y los tokens de `ui-tokens`. Ningún color fijo copiado de la maqueta.
3. Todo dato visible sale de la API. Si la API no lo entrega, la pantalla no lo inventa: o se construye el dato, o ese bloque queda fuera del PR y se anota.
4. Respeta la visibilidad: ninguna pantalla de transportista o conductor muestra el precio del viaje ni la comisión.
5. Pasa los tests de la ruta, el de accesibilidad con axe y el CI.
6. El PR adjunta captura del antes y del después con datos de prueba, no de producción.

## Lo que la sesión de diseño no comprobó

- **No se comparó cada maqueta con el marcado de su pantalla.** Se verificó que cada ruta existe, qué es, y los puntos de «Verificado contra el código». Antes de cada pantalla hay que poner la captura al lado de la pantalla real y listar las diferencias.
- **No se revisaron en producción** la vista móvil, el seguimiento público, un viaje con camión en movimiento ni la voz. El PO dejó esa revisión para después.
- **Defectos conocidos de las maquetas:** el mapa de `MovilTransportistaOfertas` queda cortado a la derecha; la etiqueta del gráfico de combustible de `TransportistaVehiculo` sale deformada; los montos de `TransportistaCobraHoy` son de relleno.

## Preguntas abiertas para el PO

Ninguna al 2026-11-25.

**«Cobra hoy» queda pendiente.** Es la posibilidad de que el transportista adelante su pago con un servicio de factoring. No está desarrollado. `TransportistaCobraHoy` no se construye hasta que el PO lo pida; sus montos son de relleno.

**Contrato.** El abogado revisó las cláusulas nuevas de las condiciones generales (1.4 a 1.6 y 11.5 a 11.8) y quedaron aprobadas, según informó el PO el 2026-11-25.

## Reparto entre sesiones

- **Implementación:** una sola sesión escribe código, en este repositorio.
- **Diseño:** la sesión de claude.ai corrige maquetas, mantiene los documentos y el contrato, y vuelve a copiar esta carpeta cuando el lienzo cambia. No toca `apps/` ni `packages/`.

## Documentos relacionados

- Revisión de la aplicación y propuesta: https://claude.ai/artifact/Ut69AoYAnVKzMrmsVbLQTm
- Investigación de QuadMinds: https://claude.ai/artifact/LfvbNNXAbNUBX5kTuUwF8K
- Carta de porte y condiciones generales: https://claude.ai/artifact/KVdfTiKkn1dsfijzXti14W
- Resolución Exenta SII N.º 144 de 2026: https://claude.ai/artifact/9r5C3o1gSG8jf1RSXT5N9h
- `docs/adr/094-comision-dentro-del-precio-del-generador.md` y `.specs/comision-dentro-del-precio/spec.md`
