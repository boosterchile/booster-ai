# Protocolo de escucha con lector de pantalla — flujos críticos (T10-11)

Es el paso humano que falta para dar por cumplido T10-11 (ver [`wcag-2026-10-09.md`](wcag-2026-10-09.md), "Lo que esta auditoría NO cubre"). CI ya verifica en cada PR la parte programática:

- axe;
- teclado y foco visible;
- reflow a 320 y 640 px;
- `aria-invalid` con su descripción;
- regiones vivas.

Aquí se juzga lo que solo se oye: si los anuncios llegan, en qué momento y si se entienden.

- **Quién:** cualquier persona que no haya construido las pantallas. No hace falta experiencia previa con lectores; las teclas están abajo.
- **Duración estimada:** 45 a 60 min para los 7 flujos.
- **Dónde:** staging o un entorno con el seed de flujos (`pnpm --filter @booster-ai/api seed:flujos-e2e`). Nunca en prod con datos reales.

## Preparación (elige uno)

| Lector | Navegador | Teclas mínimas |
|---|---|---|
| NVDA (Windows, gratis) | Chrome | `Tab` / `Shift+Tab` mueven el foco · `H` salta entre títulos · `Insert+F7` abre la lista de enlaces y títulos · `Insert+Q` sale |
| VoiceOver (macOS) | Safari | `Cmd+F5` activa · `Tab` mueve el foco · `Ctrl+Option+U` abre el rotor · `Ctrl+Option+flechas` lee |
| TalkBack (Android), solo el flujo del conductor | Chrome, PWA instalada | Deslizar a la derecha o izquierda recorre · doble toque activa |

Credenciales: las del seed de flujos (`apps/web/e2e-conductor/flujos.ts`). Para el conductor, las del seed T2 (`helpers.ts`).

## Recorrido y lo que debe oírse

Marca **Sí** o **No** en cada fila. Un **No** es un hallazgo: anótalo con la frase exacta que se oyó.

| # | Flujo y paso | Debe oírse | Sí/No |
|---|---|---|---|
| 1 | Login: RUT y clave incorrecta, Enviar | Sin mover el foco: «RUT o clave incorrectos. Verifica e intenta de nuevo.» | |
| 2 | Login: clave correcta | El título de la pantalla de inicio al cargar | |
| 3 | Nueva carga: Crear carga con el formulario vacío | Al pasar con Tab por cada campo obligatorio: su etiqueta, «inválido» o «entrada no válida», y el texto del error | |
| 4 | Nueva carga: completar y crear | El título de la carga creada; las ofertas enviadas se leen como lista o texto, sin tener que adivinar | |
| 5 | Ofertas: botón «Aceptar oferta» | El botón dice a qué carga corresponde, o el contexto inmediato lo deja claro | |
| 6 | Asignación: chat | La región de mensajes se anuncia como registro o con nombre; el campo de escribir tiene etiqueta | |
| 7 | Tracking público (sin sesión) | El estado del viaje («Asignado») y el código de seguimiento | |
| 8 | Admin: crear organización stakeholder | Cada campo con su etiqueta; tras crear, la organización nueva se puede encontrar navegando | |
| 9 | Admin: invitar miembro | Sin mover el foco: «Código de activación: …» con los 6 dígitos | |
| 10 | Activar cuenta (stakeholder) | Etiquetas de RUT, código y clave; un error de código se anuncia | |
| 11 | Zonas del stakeholder | Título «Zonas de impacto logístico» y cada zona en orden razonable | |
| 12 | Conductor: confirmar recogida | El diálogo inline se anuncia y el foco queda en él; «Sí, confirmar» se alcanza con Tab | |
| 13 | Conductor: confirmar entrega | Sin mover el foco: «Entrega confirmada. ¡Gracias!» | |
| 14 | Todos | El orden de Tab sigue el orden visual y nunca salta a algo invisible (2.4.3) | |

## Cómo registrar el resultado

1. Agrega a `wcag-2026-10-09.md` una sección "Escucha con lector de pantalla (fecha)" con:
   - el lector, la versión y el navegador usados;
   - la tabla de arriba completa.
2. Cada **No** se registra como hallazgo nuevo, con criterio WCAG y pantalla. Se corrige y se vuelve a escuchar solo esa fila.
3. Con todas las filas en **Sí**, T10-11 queda cumplido: se marca en `.specs/trl10/spec.md` con el enlace a esa sección.
