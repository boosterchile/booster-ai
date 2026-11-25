# Los diez frentes del rediseño

Copia, al 2026-11-25, del plan de «Booster — revisión de la aplicación y propuesta de rediseño» (https://claude.ai/artifact/Ut69AoYAnVKzMrmsVbLQTm), escrito tras recorrer producción el 2026-11-24 y leer el repositorio en `f06d656f`. Es el plan de trabajo del rediseño: cada frente dice qué pantallas toca, qué cambia y cuándo está hecho. Lo marcado «Nuevo» no existe hoy en la aplicación.

Dos puntos ya están decididos y el texto de abajo los plantea como pendientes: el umbral de anonimato del frente 1 es 1 camión, y el color de la acción principal del frente 8 es el verde `primary-600` (D-18).

Los frentes de la comisión (ADR-094) son otros y están en `.specs/comision-dentro-del-precio/spec.md`.

## 1. Una sola verdad por dato

Es la base de todo lo demás: el concepto pone cifras en la primera línea de cada pantalla, y esas cifras tienen que coincidir.

**Pantallas:** Flota, los dos Inicios del transportista, Conductores, Certificados, Inicio del panel.

- Un único cálculo de documentos pendientes. La cifra de Flota es la misma del Inicio y de Conductores; un documento que falta cuenta como pendiente en todas partes.
- Un único vocabulario de estado de flota: reportando, sin equipo, sin lectura. Definido una vez.
- Un único formateador de cifras: coma decimal, unidad, «CO₂e» escrito igual en todas las pantallas.
- Un glosario: «retiro», «publicar carga», un formato de patente, uno de fecha y uno de hora.
- Un único umbral de anonimato para datos agregados.

**Hecho cuando** una prueba automatizada carga la misma empresa en las pantallas afectadas y falla si dos muestran valores distintos para el mismo dato, y no queda en apps/web ninguna cifra de emisiones sin pasar por el formateador.

## 2. El sello de huella en toda la plataforma

Es la propuesta de valor hecha visible: decir en cada cifra qué se midió y qué se estimó.

**Pantallas:** Carga entregada, Huella y certificados, Inicio del generador, Elegir transportista, Publicar carga, Conductor · Entregado, Nuevo viaje propio, Empresa del transportista, Flota de la plataforma, Seguimiento público · entregada.

- Un componente de sello con dos estados, «Medido» y «Estimado», con forma, palabra y color. Va junto a cada cifra de huella.
- La tabla de qué se midió: distancia, combustible y peso, cada fila con su fuente y su clase.
- Totales siempre separados por clase. Ningún total mezcla medido con estimado.
- El nivel de certificación con su nombre y con la frase de qué faltaría para subirlo.
- Nuevo: al elegir transportista y al crear un viaje propio, la pantalla anticipa si la huella saldrá medida.
- La medición de huella pasa a ser visible en Empresa y se ofrece encendida al dar de alta.
- Lo que debe configurar Booster se pide con «Pedir a Booster», no con «Revisar sensor».
- Todos los viajes de la empresa de transporte se miden, sean del mercado o propios. El Inicio con Booster Fleet solo muestra la huella del mes igual que el del servicio completo. Cada viaje propio emite un certificado que la empresa de transporte puede entregar a su cliente; es parte de la base del servicio, no un adicional. Al registrar el viaje propio se elige para qué cliente es, y al entregarlo la pantalla «Viaje propio entregado y certificado» muestra la huella medida, el certificado emitido y la acción de enviárselo al cliente, con el total del mes para ese cliente.

**Hecho cuando** no existe cifra de emisiones sin sello en la web, y el primer certificado de nivel primario emitido se distingue a simple vista de los demás. Lo segundo depende del criterio T10-05.

## 3. El viaje por fases, de punta a punta

Un mismo viaje visto por el conductor, el transportista, el generador y quien recibe, con una pantalla que cambia en cada fase.

**Pantallas:** Conductor · Próximo viaje, En camino, Entregado, Incidente y Documentos; Transportista · Viaje en camino; Generador · Carga en camino y Carga entregada; Seguimiento público en camino y entregada.

- El bloque superior cambia con la fase: próximo viaje, en camino, entregado. Al entregar, el resultado ocupa ese lugar.
- El botón se llama por lo que hace: «Confirmar retiro», «Confirmar entrega».
- Un solo mapa por pantalla, que parte de la posición real del camión.
- «Incidente» disponible durante todo el trayecto, con motivos cerrados.
- Nuevo: evidencia de entrega. Posición al confirmar, quién recibe y foto cuando se pueda. Sin evidencia de posición, el certificado lo declara.
- Nuevo: la entrega se activa al llegar con el camión detenido.
- Nuevo: mensajes cortos y predefinidos hacia el conductor, desde el generador y desde quien recibe, leídos por audio. Reemplazan al chat de texto libre.
- Nuevo: el seguimiento público muestra el estado final con la huella y su sello.
- Nuevo: la ruta ecoeficiente se muestra con su ahorro en litros y en CO₂e frente a la ruta más rápida, al publicar una carga, al recibir una oferta, al crear un viaje propio y en la pantalla del conductor. Hoy la ruta existe, pero sin ninguna cifra: el cálculo del ahorro hay que construirlo.

**Hecho cuando** una prueba E2E recorre un viaje completo y comprueba que el primer bloque visible cambia en cada fase para los cuatro usuarios, y que una entrega confirmada lejos del destino queda marcada como sin evidencia de posición.

## 4. Del alta al primer viaje

**Pantallas:** Solicitar acceso, Entrar, Activar cuenta, Solicitudes y Empresas del panel, Conductor · Sin viajes.

- Solicitar acceso dice qué obtiene cada usuario y pregunta qué haces, empresa y teléfono.
- Cada solicitud nueva avisa por correo a los administradores, y quien es aprobado recibe su enlace sin que nadie lo copie a mano. El emisor de correo ya existe en el código; falta conectarlo a este flujo.
- Activar cuenta permite pedir un código nuevo.
- Una empresa recién activada ve en su Inicio los pasos que le faltan para su primer viaje.

**Hecho cuando** una empresa nueva pasa de solicitud a primer viaje cerrado con certificado sin que el Product Owner entregue un código ni opere a mano. Cierra T10-04.

## 5. Dos servicios, una aplicación

Booster Fleet se contrata solo; el servicio completo con Booster Spot lo integra. El diseño es el mismo y cambia lo que se muestra.

**Pantallas:** Inicio con Booster Fleet solo, Inicio con servicio completo, Ofertas, Empresa del transportista, Servicios y condiciones del panel, Empresas del panel.

- Un menú de cinco entradas para el servicio completo (Inicio, Flota, Viajes, Ofertas, Empresa) y de cuatro para Booster Fleet solo.
- Cumplimiento, Seguimiento de flota y Trayectos pasan a vivir dentro de Flota y del detalle de vehículo. Zonas pasa a Empresa. Pagos y Cobra hoy son pestañas de Viajes.
- Lo que no está contratado no ocupa lugar en el menú. Aparece como una invitación, con un dato propio de esa empresa.
- Nuevo: el dato de retornos vacíos del mes y de kilómetros vacíos evitados. Un retorno con carga cumple las dos mitades del lema: se transporta más y se evitan kilómetros vacíos.
- Empresa muestra los servicios contratados; el panel muestra qué empresa tiene cada uno.
- Al cambiar de empresa se vuelve siempre al Inicio.

**Hecho cuando** una empresa con Booster Fleet solo no ve ninguna entrada de Booster Spot en su menú, una con servicio completo ve las cinco, y ningún cambio de empresa termina en «Sin permisos».

## 6. Publicar, elegir y repetir

**Pantallas:** Publicar carga, Mis cargas, Elegir transportista, Sucursales y lugares, Inicio del generador, Empresa del generador.

- Publicar en tres pasos, partiendo por sucursales y lugares ya usados. Una sola manera visible de indicar un lugar.
- Antes de publicar: la ruta en el mapa, la huella esperada con su sello y el total a pagar.
- Mis cargas dice qué pasa con cada una y destaca la que espera una decisión.
- Nuevo: repetir una carga con un botón, desde el Inicio y desde la carga entregada.
- Nuevo: el enlace de seguimiento para quien recibe se ofrece desde el Inicio y se puede enviar automáticamente.

**Hecho cuando** un generador con una sucursal publica una carga hacia un destino ya usado sin escribir ninguna dirección, y repite una carga anterior cambiando solo la fecha.

## 7. Flota como herramienta diaria

**Pantallas:** Flota, Detalle de vehículo, Conductores, Subir un documento, Programar mantención, Viajes, Nuevo viaje propio.

- Flota abre con la frase de estado y la barra de severidad; combustible agrupado por gravedad, y lo que está en orden colapsado.
- El detalle de vehículo pone la semana del camión sobre un eje de tiempo, con el mapa de sus trayectos.
- Una desviación de combustible se describe como un hecho medido, con fecha, hora, lugar y litros, y nunca nombra a una persona.
- Subir un documento y programar una mantención son los dos formularios que cierran los pendientes.
- El viaje propio sube al menú y al Inicio, pide camión y conductor, y queda en la misma lista que los viajes del mercado.
- Toda la fila de una tabla abre su ficha, no solo la patente.

**Hecho cuando** un dueño resuelve un documento pendiente desde Flota en tres pasos y la cifra de pendientes baja en uno en todas las pantallas, y un viaje propio entregado produce su certificado.

## 8. Un solo sistema visual, fluido

**Pantallas:** todas. La fila de vistas a 390 px del lienzo es su prueba.

- Las pantallas pasan a usar los componentes de packages/ui-components, empezando por botón, tarjeta y sello.
- Un solo color para la acción principal. El sistema Booster Fleet fija el verde primario y el botón compartido usa el acento: hay que elegir uno y alinear el otro, y actualizar la sección 8 de DESIGN.md.
- Una cabecera, una convención de títulos, un componente de patente y un juego de marcas de estado con forma y palabra.
- Diseño responsivo en todas las pantallas de operador: columnas que se apilan, tablas que se desplazan en su caja y menú que pasa a barra inferior bajo 640 px.
- Un componente de mapa común, con el mismo trazo de ruta y los mismos marcadores en todas las pantallas.
- El panel de administración usa el mismo sistema: una sola cabecera, un solo idioma, sin nombres de variables ni rutas de especificación a la vista.
- DESIGN.md actualiza su apartado de estado actual.
- El lema «Transporta más, impacta menos» se escribe igual en el sitio, en la aplicación, en DESIGN.md y en el sistema de diseño Booster Fleet.

**Hecho cuando** una regla de lint falla si un archivo de apps/web pinta un botón a mano fuera de los componentes compartidos, y hay capturas de regresión visual a 1.280 y a 390 px de los Inicios, Flota y Certificados.

## 9. El conductor: voz honesta, personalización y calidez

**Pantallas:** las siete del conductor.

- La pantalla solo invita a «Oye Booster» cuando la activación por voz está encendida. Mientras tanto muestra el micrófono y lo que se puede decir.
- El Inicio abre con el saludo y el viaje. El aviso de seguridad sigue presente, al pie y en tono de copiloto.
- Nuevo: elección de tamaño de letra, color, contraste y voz, con la paleta que ya existe en los tokens.
- Los estados vacíos y el cierre de un viaje llevan una frase con la voz de Booster.
- La configuración queda en frases cortas, con el detalle técnico y legal plegado.
- Nuevo: avisos de un toque en ruta y resumen de manejo al cierre.
- Los textos se escriben para quien conduce: sin «coaching», sin referencias a ofertas que aceptó otra persona.

**Hecho cuando** una prueba E2E comprueba que, con la activación por voz apagada, el Inicio no muestra la frase «Oye Booster», que el primer elemento es el saludo o el viaje, y que el tamaño de letra elegido se conserva al volver a entrar.

## 10. Un panel de administración que muestra lo pendiente

**Pantallas:** las trece del panel.

- El Inicio abre con lo que espera a alguien de Booster, con su antigüedad: solicitudes, invitaciones por vencer, lecturas por configurar.
- Nuevo: indicadores del negocio junto a los de infraestructura: empresas activas, cargas, certificados medidos y estimados, camiones con huella medida.
- Equipos Teltonika abre con los camiones que tienen equipo y no entregan combustible. Es la tarea que más mueve la promesa.
- Cada pantalla dice el estado real de lo que muestra: una simulación sin viajes es «terminada sin viajes», unas condiciones guardadas que no rigen dicen «todavía no se aplican».
- El Observatorio indica cuántos camiones faltan para mostrar cada dato.
- Entrar como un usuario deja una franja fija mientras dura.

**Hecho cuando** el Inicio del panel muestra un contador por cada tipo de pendiente con su antigüedad, y una solicitud nueva genera un aviso que llega a los administradores en menos de cinco minutos.

## En espera

La API pública con webhooks sigue siendo la brecha técnica más clara frente a QuadMinds, y sigue sin liberar nada de la etapa activa. La dejo en espera por escrito, con la misma condición de antes: se adelanta solo si un cliente la pone como requisito de contrato.
Cobra hoy está dibujado en su estado disponible, pero su construcción depende de que el módulo se active, y esa es una decisión comercial fuera de este trabajo. Lo mismo vale para el formulario de condiciones comerciales, que no se dibujó.

## Orden que recomiendo

Primero el frente 1, porque el concepto pone cifras en la primera línea de cada pantalla y tienen que coincidir. Junto a él, el 8 en su parte de componentes: el sello, el mapa y la cabecera se usan en todos los demás. Después el 2 y el 3, que son los que hacen visible la propuesta de valor y comparten pantallas. El 5 ordena el menú y conviene antes de construir el 6 y el 7, que llenan sus secciones. El 4 y el 10 van juntos, porque el alta depende del panel. El 9 puede avanzar en paralelo desde el inicio: toca solo las pantallas del conductor.

## Lo que las maquetas suponen y hoy no existe

- Evidencia de entrega: posición al confirmar, quién recibe y foto.
- La entrega condicionada a estar en el destino con el camión detenido.
- Mensajes cortos y predefinidos hacia el conductor, en lugar del chat de texto libre.
- Avisos de un toque y resumen de manejo al cierre del viaje.
- Elección de letra, color, contraste y voz para el conductor.
- Indicadores del negocio y contadores de pendientes en el panel de administración.
- El aviso por correo de cada solicitud nueva y del enlace a quien es aprobado.
- Repetir una carga, publicar desde una sucursal y ver el total antes de publicar.
- La invitación a Booster Spot basada en retornos vacíos, y el dato de kilómetros vacíos evitados.
