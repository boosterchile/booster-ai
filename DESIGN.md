# Booster — Sistema de Experiencia (DESIGN.md)

> **Booster: Impacta menos, transporta más.**

**Estado:** Borrador v1 · Fase D0 del sistema de experiencia (d-máximo)
**Propósito:** Este documento es el cimiento de identidad de producto de Booster. Gobierna cómo se ve, cómo suena, cómo se siente y cómo se comporta la plataforma en todas sus superficies. De él se derivan los tokens (D1), los componentes (D2) y los patrones de interacción y accesibilidad (D3). Ningún elemento visual o de interacción debería construirse sin poder trazarse a un principio de este documento.
**Autoridad:** La visión y las decisiones de este documento pertenecen al Product Owner (Felipe Vicencio). El agente de construcción implementa, no define, la identidad aquí descrita.

Este documento tiene dos apartados que se complementan y **no se resumen entre sí**:

- **Parte I — Principios.** La visión, legible para cualquier persona del equipo. El *por qué* y el *qué se siente*.
- **Parte II — Sistema técnico-operativo.** Las especificaciones que alimentan la construcción. El *cómo* concreto.

---

# PARTE I — PRINCIPIOS

## 1. La promesa central

Todo en Booster existe para cumplir una promesa: **Impacta menos, transporta más.** No es un eslogan de marketing — es el criterio con el que se juzga cada decisión de diseño. Una pantalla, una interacción o una palabra que no sirva a esa promesa está de más.

Booster mide de verdad lo que otros solo declaran. Ese mismo rigor —sustancia sobre apariencia— gobierna la experiencia: **no decoramos, resolvemos.**

## 2. El sentimiento core

**Rápido. Sin fricción. Simple.**

Este es el norte transversal. Toda superficie de Booster se defiende por lo que quita, no por lo que agrega. Si una pantalla tiene un paso de más, un campo innecesario, un adorno que no comunica, o una decisión que el usuario no debería tener que tomar — está mal.

La vara son **Stripe** (simplicidad engañosa: mucho poder, cero ruido; tipografía y espaciado impecables; todo se siente "correcto") y **Linear** (claridad y velocidad: la app *se siente* rápida; jerarquía visual perfecta; cero decoración inútil).

"Simple" no significa "pobre". Significa que la complejidad vive por debajo, resuelta, y arriba solo queda lo esencial. Como Stripe: detrás hay un sistema financiero enorme; delante, un botón que funciona.

## 3. Personalidad: Booster es "buena onda"

Stripe y Linear son serios. Booster es serio **pero tiene alma.**

La personalidad de Booster se define con un concepto chileno preciso e intraducible: **Booster es "buena onda".** No es "friendly" ni "playful" en inglés — "buena onda" es específico: cercano sin ser informal, cálido sin perder respeto, claramente **del lado del otro.** Es el tono que baja la guardia del conductor que teme el control, y que alivia al operador que corre contra el reloj. Es identidad de marca, y es chilena a propósito.

Lo lúdico no es opcional ni decorativo: **es principio transversal, sí o sí** — y aplica a **todos los usuarios operativos por igual**, no solo al conductor. Booster tiene momentos de humanidad porque sus usuarios son personas reales bajo presión, no engranajes:

- **El conductor** teme ser vigilado y maneja solo por horas.
- **El operador del generador de carga** corre contra el reloj gestionando cargas.
- **El operador de la empresa de transporte** está igualmente bajo fuerte carga coordinando flota y conductores.

Los tres están sometidos a fuertes cargas de trabajo, y **Booster es su apoyo en la gestión** — un apoyo que es "buena onda", no una herramienta fría. Quien está más estresado es precisamente quien más necesita que la herramienta lo acompañe. El operador también merece su frase de aliento al cerrar una jornada dura, su micro-celebración al completar un match difícil, su momento de humanidad.

**La regla de dosificación** (esto es lo delicado): lo lúdico vive en **momentos elegidos**, no en todas partes. Manda la sobriedad en los lugares de trabajo serio (tablas de datos, formularios críticos, información financiera, certificados). Aparece la calidez y el juego en los **momentos humanos**: inicio y fin de trayecto o de jornada, confirmaciones, logros, estados vacíos, onboarding, y —de forma especial— en la voz del conductor. Demasiado juego traiciona a Stripe/Linear; nada de juego traiciona a Booster. El sistema define dónde va cada cosa, y esto vale para todas las superficies operativas.

**Los "momentos humanos" son una capa transversal del sistema, no una feature de un rol.** La *lógica* de cuándo aparece un momento humano (frase optimista, chiste, felicitación, aliento) es compartida entre usuarios; **el canal de expresión depende del contexto**:

- Para el **conductor** → por **voz** (Booster le habla: frase optimista al iniciar/terminar trayecto, chiste en la ruta, aliento).
- Para los **operadores** → por **UI** (un mensaje cálido al vaciar la bandeja, una micro-celebración al cerrar un match difícil, un estado vacío con onda, una frase al terminar la jornada).

Mismo principio, dos canales. Esto se diseña como **sistema** (D2/D3), no como parches por pantalla — y sobre todo **no dentro de las primitivas.** Una primitiva (un Button, un Input) es tonta: consume tokens, expone comportamiento, no tiene personalidad. Hornear la personalidad dentro de la primitiva es un error de categoría y rompe "derivá, no dupliques" (el mismo chiste terminaría repetido en cada componente que lo use).

La personalidad opera en una cadena de **cuatro capas**, cada una con una sola razón de existir:

```
primitiva tonta  →  componente-de-momento  →  contenido  →  adaptador de canal
```

- **Primitiva tonta** (Button, Card, Input…): token-driven, sin personalidad.
- **Componente-de-momento** (EmptyState, SuccessMoment, LoadingMoment): la estructura del momento. Consume primitivas.
- **Contenido**: el registro de frases/chistes/tono. Se escribe una vez.
- **Adaptador de canal**: decide cómo se entrega el momento — voz para el conductor, UI para el operador.

El chiste se escribe una sola vez y el adaptador lo entrega por voz o por pantalla según el usuario. El split voz/UI vive en un solo lugar (los ~4-5 touchpoints reales), no repetido en cada componente. **`packages/ui-components` contiene solo primitivas tontas; la capa de momentos es separada.**

## 4. Los usuarios — cuatro usuarios en dos mundos

Booster tiene cuatro tipos de usuario. La distinción más importante del sistema **no es entre roles, sino entre dos mundos:**

- **Mundo autenticado** (usan la app, con login RUT+clave, design system "producto"): el conductor y los dos operadores. Son usuarios recurrentes que gestionan trabajo.
- **Mundo público-efímero** (sin cuenta, acceso por código, cara de marca): el destinatario de la carga. Es un usuario de paso, sin login, que ve una cosa y se va.

Esta línea —autenticado vs público-efímero— es la divisoria estructural del sistema, y define registros visuales, superficies y patrones distintos.

Un principio rector transversal: **quien paga no es necesariamente quien usa.** La retención y la recomendación las deciden los usuarios directos (conductor, operadores) y la experiencia del destinatario, no solo quien firma el contrato. Por eso su experiencia es prioritaria.

### 4.1 El conductor — usuario crítico (mundo autenticado)

Es el eslabón que define la adopción de toda la plataforma. Si al conductor le gusta Booster, transmite los datos, adopta el GPS (que hoy **teme**), y **recomienda**. Si le disgusta, no hay telemetría, no hay medición de huella, se cae la propuesta de valor.

**Registro emocional: confianza + no-vigilancia.** El conductor debe sentir que Booster está **de su lado**, no encima de él. El temor al control por GPS se disuelve cuando la app es claramente una aliada.

**La app del conductor es voice-first (~90%), no visual-first.** El conductor va manejando; no mira la pantalla. Su interfaz principal es **la voz**. Esto es un paradigma, no un feature. (Ver sección 5.)

**Booster está del lado del conductor** de formas tangibles que no tienen que ver con el trabajo que Booster le pide:
- Le recomienda **picadas** (buenos restaurantes) en su ruta.
- Le dice dónde está el **combustible más barato** en el camino.
- Le acompaña con una **frase optimista** al iniciar y terminar un trayecto.
- Le cuenta un **chiste** de vez en cuando, porque manejar es solitario.

El GPS que teme viene envuelto en un copiloto que le mejora el día. **Booster no es una app de tracking — es un copiloto que además transmite telemetría.** Esa inversión es la mejor estrategia de adopción posible.

**Principio de protección del conductor:** el conductor es el eslabón crítico y su confianza es el activo más frágil del sistema. Por eso, **cuando el interés de otro usuario choca con la confianza o la no-vigilancia del conductor, se protege al conductor.** Ninguna comodidad para otro usuario justifica darle una herramienta de control o presión sobre el conductor. Este principio gobierna todas las funciones que conectan a otros usuarios con el conductor (ver ejemplo en 4.3: el mensaje estructurado del destinatario).

### 4.2 Los operadores — usuarios diarios bajo presión (mundo autenticado)

Hay **dos tipos de operador**, ambos usan la plataforma día a día y ambos están bajo fuerte carga de trabajo:

- **El operador del generador de carga** — gestiona cargas, publica, sigue el matching, y **accede a la ubicación del transporte** (tracking en vivo de sus cargas). Su satisfacción define si el generador sigue pagando.
- **El operador de la empresa de transporte (transportista)** — coordina flota, conductores, asignaciones, y también **accede a la ubicación del transporte**. Su satisfacción define si la transportista sigue operando en Booster.

Ninguno es necesariamente quien paga, pero de su experiencia depende la retención.

**Registro emocional: eficiencia + control + apoyo.** El operador necesita **potencia sin fricción**. Aquí "simple" se vive distinto que en el conductor: puede necesitar **densidad de información** (tablas, filtros, estados de matching) — lo opuesto a las cards grandes del conductor. El sistema da simplicidad al conductor y potencia-sin-fricción al operador **con los mismos componentes base, configurados distinto** — aunque, como se detalla en 4.5, ese eje **no aplica a todos los componentes por igual.**

Pero "eficiencia" no significa "frialdad": el operador está estresado y **Booster es su apoyo, con la misma "buena onda"** (sección 3). Sus momentos humanos —cerrar jornada, resolver un match difícil, vaciar una bandeja— también merecen calidez.

### 4.3 El destinatario de la carga — seguimiento por código (mundo público-efímero)

**Este es un diferenciador comercial de valor trascendental**, no un usuario menor.

Quien recibe la carga hace seguimiento con un **código** (el `codigo_seguimiento` que ya existe en el modelo de datos), **sin crear cuenta, sin login.** El código *es* el acceso. Es un usuario de paso, probablemente de un solo uso.

**El dolor que resuelve:** hoy todos los servicios logísticos entregan en una *ventana horaria* ("llega entre las 8 y las 18") y dejan al receptor **esperando a ciegas, con información parcial.** Nadie en el flete de carga resolvió esto bien. Booster lo resuelve **como Uber**: el receptor ve el vehículo moviéndose en el mapa y sabe cuándo va a llegar. Deja de esperar a ciegas.

**Por qué es trascendental (tres valores comerciales):**
1. **Diferenciador de venta al que paga:** al generador le vendés que *sus* clientes van a saber cuándo llega su carga, como un Uber — mejora la relación del generador con SUS receptores. Valor que se propaga.
2. **Marketing viral hacia futuros clientes:** el receptor de hoy (que también envía carga) experimenta Booster sin ser cliente. Cada entrega es una demo ante un potencial cliente. Es adquisición gratuita, y **visibiliza la marca.**
3. **Espacio de mercado abierto:** nadie hace "tracking tipo Uber para carga". Booster tiene la telemetría real para hacerlo de verdad, no simulado.

**Registro emocional: tranquilidad + claridad.** El destinatario no es un usuario recurrente estresado; quiere una respuesta rápida ("¿dónde está mi carga?") y planificar. Acá la "buena onda" es *claridad y calma* ("tu carga va en camino, llega aprox. en la tarde"), no chistes.

**Qué ve y qué puede hacer (V1 — decisión de scope tomada):**
- **Ubicación en vivo en mapa** — el vehículo moviéndose, alimentado por la telemetría real.
- **Estado + ventana estimada de llegada** — NO ETA calculado en tiempo real. Decisión deliberada: el ETA dinámico confiable (ruta + tráfico + paradas) le exige demasiado al sistema, y la ubicación en vivo + ventana ya es una ventaja competitiva muy significativa. Se resuelve el dolor sin caer en sobre-ingeniería. (El ETA dinámico queda como posible evolución futura, explícitamente fuera de V1.)
- **Enviar un mensaje al conductor** — el receptor puede avisar algo útil ("estoy en el portón de atrás", "recibo después de las 15"). Pero este canal tiene un **límite de principio, no solo técnico:** debe ser **muy limitado, con mensajes estructurados** (opciones predefinidas o plantillas), y **jamás puede convertirse en un mecanismo de control sobre el conductor.** Un canal de texto libre permitiría al destinatario presionar o vigilar al conductor ("¿por qué vas lento?", "apurate", "¿dónde estás?") — exactamente lo que el conductor teme (sección 4.1) y lo que todo el sistema trabaja para evitar. **Cuando el interés del destinatario (comunicarse) choca con el del conductor (no ser controlado), se protege al conductor**, porque es el eslabón crítico de la plataforma. El destinatario obtiene utilidad (información contextual de entrega) sin obtener una vara de presión. Mensajes estructurados, acotados al viaje, sin chat abierto.

**Es vitrina de marca hacia afuera:** el destinatario suele ser el cliente de tu cliente (si el generador es un exportador que manda fruta a un supermercado, el destinatario es el supermercado). Una experiencia impecable es marketing ante un potencial cliente futuro.

### 4.4 El comprador — quien decide y paga

El dueño del generador, el gerente de flota. Decide la compra, pero su satisfacción depende de que sus operadores, conductores y **la experiencia de sus destinatarios** estén a la altura.

**Registro emocional: profesionalismo + ROI.** Ve el valor, la seriedad, el retorno. Su superficie principal es comercial (el sitio de marketing) y los reportes/certificados. Y ahora tiene un argumento de venta extra: el tracking Uber-like que mejora *su* relación con sus clientes.

### 4.5 Una misma base, configurada por usuario — pero el eje no es universal

Adaptar la experiencia por usuario (conductor simple / operador denso) es correcto como intención, pero **no se aplica de forma uniforme a todos los componentes.** El conductor es voice-first ~90%: su superficie visual es delgada. No lee tablas ni navega tabs mientras maneja. Tratar "modo conductor" como un flag universal presente en cada componente produce configuración vacía en la mitad de ellos.

Los componentes se agrupan en tres registros según cómo —y si— el eje conductor/operador aplica:

1. **Duales de verdad** — viven en ambos mundos y sí llevan el eje: **Button, Card, Input, Modal, Toast.** Acá el registro cambia tamaño de touch target, densidad de padding y jerarquía. Conductor = grande, alto contraste, una cosa a la vez. Operador = denso, set completo de variantes, opción compacta. **Matiz de Modal** (implementado en Ola 2): responde al registro —hereda las custom properties— pero **se optimiza para operador**; el conductor es voice-first ~90% y casi no ve modales, así que no lleva variante-conductor elaborada. Nota técnica: el Modal portea al `body`, fuera del ancestro del registro, así que **re-aplica `data-register` en el portal**; el **acento se hereda solo** (vive en `:root`), no se re-aplica.
2. **Operador-first** — el conductor casi no los toca; no se les inventa un "modo conductor": **DataTable, Tabs, Dropdown, Select.** Viven en el contexto operador.
3. **Semántico-compartido** — fijos, no dependen ni del acento ni del registro: **Badge** y los estados éxito/error/warning (cerrado en #576). Es el tablero del auto que no cambia con los LED de cabina.

**Consecuencia de diseño:** el esfuerzo de "modo conductor" se concentra en las 5 duales, no se dispersa en las 11. No se sobre-invierte en variantes-conductor que el conductor casi no ve.

## 5. La voz de Booster (VUI)

La experiencia del conductor tiene una dimensión que las pantallas no tienen: **el sonido.**

**Quién habla:** Es **Booster** mismo quien habla. Personalidad **cálida, con humor chileno.** No es un asistente genérico — es Booster acompañando al conductor.

**Alcance deliberadamente acotado** (para que sea construible, no un producto de IA conversacional imposible): Booster **se comunica con el conductor por voz** (informa, acompaña, avisa, celebra) **más de lo que sostiene un diálogo.** No es conversación bidireccional abierta. El conductor **puede solicitar ejecución de comandos** (acciones discretas por voz), pero el paradigma es "Booster habla + el conductor invoca comandos", no "Booster y el conductor conversan".

**Customizable:** el conductor **elige la voz** (esto conecta con el pilar de customización — sección 6).

**Qué diseña la capa de voz:** cómo suena Booster, qué dice, cuándo habla y cuándo calla, cómo pide confirmación por voz, cómo entrega información útil (picadas, combustible), cómo lee una frase optimista o un chiste. Es diseño de interacción por voz — una disciplina propia dentro del sistema.

## 6. Customización — la app es del usuario, no de quien paga

La app tiene un **registro visual propio** (ni el fucsia comercial del sitio de marketing, ni el verde ambiental — un tercer registro "producto"), y es **profundamente customizable.** Esto es decisión comercial pensada en los usuarios, no en quien paga: una herramienta que se adapta a vos es una herramienta que hacés tuya, y una herramienta propia es una que no temés.

La customización tiene **tres dimensiones integradas desde el cimiento** (se diseña desde los tokens, no se agrega después):

1. **Cosmética** — el usuario ajusta apariencia a su gusto (tema, color, tamaño). La app se siente *suya*.
2. **Inclusiva** — la interfaz representa a quien la usa. Hoy existen conductores **y conductoras**; el lenguaje, las imágenes y el tono respetan género e identidad. Que un conductor *o* una conductora se sienta representado/a en cómo Booster le habla y se ve.
3. **Funcional / accesible-adaptativa** — la interfaz se adapta al **contexto real de uso**: letra más grande, alto contraste para el sol, modo de una mano, voice-first para manejar. Crítica para el conductor en movimiento.

**La customización tiene niveles según el usuario, pero el sistema la soporta completa desde el cimiento.** No todos necesitan lo mismo:

- El **conductor** necesita customización *profunda* (color + tamaño de letra + contraste + voz elegible + modo una-mano), porque su contexto de uso es exigente.
- Los **operadores** quizás solo necesiten customización *cosmética* (el color, para que la app se sienta suya) — pero **esto es importante igual**: aunque sea solo el color, que el operador pueda hacer suya la herramienta es parte de la "buena onda" y de la adopción.

**Consecuencia técnica clave (para D1):** aunque al inicio se exponga menos customización al operador que al conductor, **el sistema de tokens debe ser theme-able en runtime desde el día uno.** Si los tokens no contemplan el theming dinámico desde el cimiento, agregar "cambiar color" después es reescribir el sistema. Se diseña completo, se expone gradualmente.

## 7. Accesibilidad — funcionalidad, no compliance

Para el conductor —que usa la app en un celular, en movimiento, quizás con el sol de frente, quizás con guantes— la accesibilidad **no es un checkbox de norma: es funcionalidad core.** Una app inaccesible para el conductor es una app rota, no una app que incumple una regla.

La accesibilidad es **real y verificada**, no nominal. (Ver Parte II, sección D3.)

**Postura de implementación — React Aria (headless puro).** El comportamiento accesible de los componentes difíciles —focus-trap y retorno de foco en Modal, roving tabindex en Tabs, manejo de portales y teclado en Dropdown y Select— se resuelve con **`react-aria-components`** (React Aria, de Adobe), no hand-rolleado. Esos comportamientos son exactamente donde se meten bugs sutiles de a11y, y el conductor puede depender de accesibilidad real. React Aria es **headless puro**: aporta el comportamiento accesible, cero estilos — el 100% de la apariencia la ponen nuestros tokens.

Esto **no contradice** la postura de "sin opiniones de diseño de terceros" del stack. Lo que se evitó deliberadamente fue **shadcn** (Radix + estilos con opinión). Una primitiva headless pura es otra cosa: no trae diseño. Se preserva el control total de la apariencia sin reinventar la rueda difícil de la accesibilidad.

**Alcance:** React Aria se usa solo para el comportamiento de los componentes difíciles (Modal/Dialog, Dropdown/Menu, Select/ComboBox, Tabs). Las primitivas simples (Button, Badge, Card, Input, Toast) se construyen a mano con tokens; no necesitan React Aria. El encaje in-repo (versión compatible con el React del proyecto, compatibilidad con Tailwind 4, delta de bundle) se verifica antes de construir Modal.

## 8. Registros de color — qué significa cada uno

Booster usa el color con **significado**, no por decoración. Hay tres registros, cada uno con un propósito:

- **Comercial (fucsia + azul):** la cara de venta hacia clientes potenciales. Moderna, atractiva, la personalidad de marca. Vive en el sitio de marketing (www) **y en la página pública de seguimiento del destinatario** (sección 4.3) — porque ambas son cara-hacia-afuera y vitrina de marca ante potenciales clientes.
- **Ambiental (verde):** reservado para lo relacionado con impacto ambiental y medición de huella. El verde en Booster **significa algo verificado** — a diferencia de la competencia (Fleteretorno) que usa el verde como apariencia sin medición detrás. No lo malgastamos en decoración; cuando aparece, es porque hay sustancia ambiental real.
- **Producto (propio, customizable):** el registro de la app del mundo autenticado, donde viven el conductor y los operadores. Distinto de los otros dos, y adaptable por el usuario (sección 6).

---

# PARTE II — SISTEMA TÉCNICO-OPERATIVO

Esta parte alimenta la construcción (D1–D3). Documenta el estado real actual (base sobre la que se construye, no se rediseña desde cero) y las decisiones y trabajo pendientes.

## Estado actual verificado (punto de partida real)

### Tokens existentes — `packages/ui-tokens` (sistema canónico, maduro)
Sistema rico y documentado en TypeScript, fuente única declarada, consumido por `apps/web`:
- **Color** (`colors.ts`): `primary` verde Booster (50–950, brand `#1FA058`) · `neutral` cálidos (0–1000, beige `#FAF9F7`) · `accent` ámbar (urgencia) · `semantic` (success/warning/danger/info) · `semanticColors` con aliases (bgCanvas, textPrimary, borderBrand, statusSuccessBg…) para theming futuro.
- **Tipografía** (`typography.ts`): `fontFamily` (Inter sans / JetBrains Mono) · `fontSize` xs 12px→7xl 72px · `fontWeight` 400–700 · `lineHeight` · `letterSpacing` · `textStyles` pre-compuestos (display1, h1–h5, body, caption, label, mono).
- **Spacing** (`spacing.ts`): base 4px, escala 0→96 (matchea Tailwind).
- **Radius** (`radius.ts`): none→3xl + full; convención: botones/inputs md(8px), cards lg(12px), modales xl(16px).
- **Shadow** (`shadow.ts`): xs→2xl + inner + `focusRing` (0 0 0 3px rgb(31 160 88/.35)) y `focusRingDanger`.
- **Breakpoints** (`breakpoint.ts`): mobile-first, sm 640→2xl 1536 (matchea Tailwind).
- **Z-index** (`z-index.ts`): escala canónica base→max (dropdown 1000, modal 1400, toast 1600) — evita guerra de z-9999.
- **Duration/Easing** (`duration.ts`): fast 120ms→slower 480ms + easings (inOut, spring).

**Deuda conocida:** el `index.ts` referencia un `DESIGN.md` como brief de marca que **no existía** — este documento lo resuelve.

### Registro comercial — `booster-landing` @theme (repo aparte)
Sistema fucsia, más delgado (solo color + 2 fuentes; usa defaults de Tailwind para escalas):
- Colores: `accent-pink #d946ef` (fucsia, el "primary" comercial de facto), `accent-blue #3b82f6`, `accent-lime #84cc16`, `rich-black #111827`, `charcoal #374151`, `background-base #FFFFFF`, `background-subtle #F9FAFB`.
- Fuentes: Inter (sans) + Flipahaus/Outfit (logo).
- Utilities propias: `glass`, `glass-card`, `text-stroke-1`, animación `move-path` (el camión del mapa).

### Componentes existentes — capa vacía (hallazgo crítico)
- **`packages/ui-components`: cimiento presente, primitivas pendientes.** Ola 0 (#577, ya en main) aterrizó el helper `cn()` y el sistema de registro/densidad CSS-driven (`RegisterProvider` + tokens `data-register`/`data-density`, mismo patrón runtime que `data-accent`). **Todavía no hay primitivas base compartidas** — son Ola 1.
- En `apps/web` solo `FormField.tsx` está abstraído (label + hint + error + ARIA via render-prop, helper `inputClass`). Reutilizado en 10+ archivos.
- **Ausentes como primitivas base:** Button, Card, Badge, Table, Select, Toast, Tabs, Dropdown, Modal (Ola 1). El helper `cn()` ya existe (Ola 0).
- **La consistencia hoy es frágil:** botones son `<button className="…bg-primary-600…">` copiado a mano en ~21 archivos; tablas son `<table>` crudo en 12 rutas; selects crudos en 6; tabs hand-rolled con `role="tab"`+useState.
- **Hoy** sin librería headless de terceros (Tailwind plano + clases de token). **Decisión de este documento (D-17, §7):** adoptar **React Aria** (`react-aria-components`, headless puro) para el *comportamiento* accesible de los componentes difíciles (Modal, Dropdown, Select, Tabs). No revive shadcn/Radix-con-estilos (deliberadamente evitados); las primitivas simples siguen a mano con tokens, y la apariencia queda 100% en nuestros tokens.

### Duplicación de fuente de verdad
`apps/web/src/styles.css` **re-declara los tokens a mano** en un bloque `@theme` (el comentario lo admite: "espejo de los tokens… source-of-truth manual"). Los tokens viven duplicados en dos lugares — a resolver en D1.

### Accesibilidad — nominal, no efectiva (hallazgo crítico)
- `@axe-core/playwright` está como dep y el job de CI se llama "Playwright + axe-core (a11y)", **pero ningún archivo importa axe, ningún spec escribe los `a11y-*.json`, y el job se salta en PRs** (solo nightly contra prod). La a11y automatizada es fantasma.
- Lo real de a11y hoy es a nivel componente: `FormField` cablea aria-describedby/role="alert"/aria-label; `styles.css` tiene focus-ring global accesible (contraste 3:1).

### Responsive — mobile-first real
Viewport notch-aware (viewport-fit=cover); tokens de breakpoint mobile-first; uso real fuertemente centrado en móvil. El conductor explícitamente diseñado para celular; el generador con tablas que colapsan a cards en móvil.

### Superficies por usuario (estado actual)
- **Conductor:** rutas dentro de `apps/web` (no PWA aparte). Una sola PWA compartida (manifest "Booster AI", display standalone, SW = push). Al entrar con rol conductor, redirige a `/app/conductor`. Auth RUT+PIN. Pantallas mobile-first: login, dashboard (ver viaje + "iniciar reporte GPS"), configuración modo conductor (audio coaching, permisos mic/GPS, comandos de voz), detalle asignación. Voice-first germinando ("Oye Booster", coaching) montado en el detalle, **no como paradigma central** — a elevar en fase (b).
- **Operador del generador:** rutas en `apps/web` gateadas por rol en render. Shell `Layout.tsx` sin sidebar; navegación como cards en dashboard. Pantallas: dashboard, crear/publicar carga, mis cargas, detalle carga, tracking en vivo, certificados GLEC, sucursales.
- **Shell:** un solo `Layout.tsx` sin nav por rol; navegación por cards de dashboard. Conductor tiene su propio header sin sidebar.

## Decisiones tomadas (de la Parte I)

| # | Decisión | Consecuencia técnica |
|---|----------|----------------------|
| D-1 | Sentimiento core: rápido/simple (vara Stripe/Linear) | Minimalismo por defecto; cada componente se justifica |
| D-2 | "Buena onda" = personalidad transversal; lo lúdico es principio para TODOS los usuarios operativos (conductor + ambos operadores), dosificado por contexto | El sistema define zonas "sobrias" vs "con alma" en todas las superficies operativas |
| D-3 | Tres registros de color con significado (comercial/ambiental/producto) | Múltiples sets de tokens coordinados, no uno solo |
| D-4 | App tiene registro "producto" propio, distinto de comercial y ambiental | Nuevo set de tokens de app, no reusa fucsia ni verde como identidad |
| D-5 | Customización triple (cosmética + inclusiva + funcional), con niveles por usuario pero **sistema theme-able en runtime desde el día uno** | Tokens diseñados para theming dinámico; capa de preferencias; se expone gradual (operador: color; conductor: profunda) |
| D-6 | Conductor voice-first (~90%): Booster habla + comandos, no diálogo | Capa VUI en el sistema; app del conductor es producto propio |
| D-6b | "Momentos humanos" son capa transversal: misma lógica, distinto canal (voz para conductor, UI para operadores) | Sistema de momentos humanos compartido, con adaptadores de canal |
| D-7 | Voz de Booster: cálida, humor chileno, voz elegible por el conductor | TTS con personalidad + selección de voz (parte de customización) |
| D-8 | Accesibilidad real y verificada, no nominal | Activar axe en CI, escribir specs, a11y en cada componente |
| D-9 | Propuesta de valor "Impacta menos, transporta más" como hilo conductor | Presente en el tono de todas las superficies |
| D-10 | Cuatro usuarios en **dos mundos**: autenticado (conductor + 2 operadores, app) vs público-efímero (destinatario, por código) | La línea autenticado/público es la divisoria estructural; registros y superficies distintas |
| D-11 | Destinatario = tracking Uber-like por código, sin login, **diferenciador comercial trascendental** | Superficie pública separada; registro comercial; mobile-first; vitrina de marca |
| D-12 | Destinatario V1 = ubicación en vivo + ventana estimada, **NO ETA calculado en tiempo real** | Recorte deliberado: resuelve el dolor sin sobre-ingeniería; ETA dinámico fuera de V1 |
| D-13 | Destinatario puede mensajear al conductor, **mensajes estructurados, acotado al viaje** — nunca control sobre el conductor | Opciones predefinidas/plantillas, sin texto libre; protege al conductor |
| D-14 | **Principio de protección del conductor:** ante conflicto entre otro usuario y la no-vigilancia del conductor, se protege al conductor | Gobierna toda función que conecte otros usuarios con el conductor |
| D-15 | El eje conductor/operador **no es universal**: solo las 5 duales (Button, Card, Input, Modal, Toast) lo llevan; las operador-first (DataTable, Tabs, Dropdown, Select) no tienen "modo conductor"; las semántico-compartidas (Badge, estados) son fijas | El esfuerzo de registro se concentra en 5 duales, no se dispersa en las 11 (ver 4.5) |
| D-16 | Las primitivas de `ui-components` son **tontas** (token-driven, sin personalidad); los momentos humanos son **capa separada**: primitiva → componente-de-momento → contenido → adaptador de canal | La personalidad no se hornea en la primitiva; el split voz/UI y el contenido viven en un solo lugar, no repetidos por componente |
| D-17 | **React Aria** (`react-aria-components`, headless puro) para el comportamiento accesible de los componentes difíciles (Modal, Dropdown, Select, Tabs); primitivas simples a mano con tokens | A11y real sin reinventar la rueda difícil; cero estilos de terceros (no shadcn/Radix); apariencia 100% por tokens |

## Trabajo pendiente por fase

### D1 — Tokens formalizados
- Resolver la duplicación ui-tokens ↔ styles.css (source of truth único).
- Definir el set de tokens del **registro "producto"** de la app (D-4): la paleta propia, distinta de fucsia y verde.
- Diseñar los tokens para soportar **customización en runtime desde el día uno** (D-5): theming cosmético dinámico, variantes inclusivas, y ajustes funcionales (tamaño, contraste). **Requisito duro:** el sistema debe ser theme-able en runtime aunque al inicio solo se exponga "cambiar color" al operador — no se puede agregar después sin reescribir.
- Coordinar los tres registros (comercial/ambiental/producto) como sistema, con reglas de cuándo aplica cada uno.

### D2 — Librería de componentes base
- Llenar `packages/ui-components` **con primitivas tontas** (token-driven, sin personalidad — D-16): Button, Card, Input, Select, Modal, Table (DataTable), Badge, Toast, Tabs, Dropdown, y helper `cn()`.
- Cada componente consume tokens de D1 y soporta los tres registros + customización.
- Accesibilidad real incorporada en cada primitiva (no agregada después). El **comportamiento** accesible de los componentes difíciles (Modal, Dropdown, Select, Tabs) se apoya en **React Aria** headless (D-17, §7); las primitivas simples se cablean a mano con tokens.
- **El eje conductor/operador NO es universal (D-15):** se concentra en las 5 duales (Button, Card, Input, Modal, Toast); las operador-first (DataTable, Tabs, Dropdown, Select) no inventan "modo conductor"; las semántico-compartidas (Badge, estados) son fijas. Ver 4.5.
- Definir dónde vive lo lúdico (D-2): micro-interacciones y animaciones con personalidad **en los componentes-de-momento, nunca en las primitivas** (D-16).
- **Sistema de "momentos humanos" (D-6b/D-16):** capa **separada** de las primitivas, en la cadena *primitiva tonta → componente-de-momento → contenido → adaptador de canal* (§3). La lógica de *cuándo* es compartida; el *cómo se entrega* (voz para el conductor vía VUI, UI para los operadores) lo decide el adaptador de canal; el contenido (frases/chistes) se escribe una vez.

### D3 — Patrones de interacción + accesibilidad + voz
- Patrones de navegación (respetando el shell sin-sidebar / cards-dashboard actual).
- Patrones de feedback, estados de carga/error/vacío.
- Animaciones (usando tokens de duration/easing) — sobrias donde toca, lúdicas donde toca.
- **Accesibilidad real:** activar axe-core en CI (hoy fantasma), escribir los specs, estándar aplicado y verificado.
- **Capa VUI (D-6/D-7):** diseño de la voz de Booster — cómo suena, qué dice, cuándo, comandos disponibles, selección de voz. (Nota: la implementación técnica completa del voice-first es un producto en sí mismo y se planifica en detalle en la fase (b) — el conductor.)

## Nota de roadmap — dónde encaja cada usuario

El orden de trabajo del producto (decisión del PO) es: **(d) este sistema de experiencia → (b) el conductor → (c) los operadores → (a) el sitio comercial.**

El **destinatario** (sección 4.3) es un caso especial: pertenece al mundo público, es un diferenciador comercial de alto valor, y su superficie está más cerca del sitio comercial (a) que de la app. Su planificación detallada se coordina con (a) o como su propio bloque, pero su naturaleza queda definida aquí en el cimiento para que el sistema lo contemple desde el inicio y no sea un parche posterior. Técnicamente, V1 del destinatario se apoya en la telemetría en vivo que ya existe (la misma que alimenta el tracking de los operadores) — el trabajo nuevo es la superficie pública, no la captura de datos.

## Preguntas abiertas (a resolver en fases siguientes)
- ¿La customización cosmética tiene presets curados o libertad total? (definir en D1)
- ¿El registro "producto" de la app tiene una paleta base ya intuida, o se diseña en D1?
- ¿Qué comandos de voz específicos existen en el MVP del conductor? (definir en fase b)
- ¿Las picadas y el combustible son datos propios, integración de terceros, o crowd-sourced? (fase b, decisión de producto + técnica)
- **Destinatario:** ¿la página pública de seguimiento vive en el sitio de marketing (booster-landing / #426) o es una superficie propia? ¿Reusa el registro comercial tal cual o tiene su propia identidad de "tracking"? (definir cuando se planifique el destinatario)
- **Destinatario:** ¿cómo se genera y comparte el código con el receptor? (SMS, email, lo comparte el generador — decisión de producto + técnica)
- **Mensaje al conductor:** ¿qué set exacto de mensajes estructurados se ofrece? (opciones predefinidas / plantillas de entrega — nunca texto libre; diseño que da utilidad al destinatario sin dar control sobre el conductor, D-14)

---

*Este documento vive en el repositorio como fuente de verdad de la identidad de Booster. Se actualiza cuando el PO evoluciona la visión. Toda construcción de UI/UX debe poder trazarse a un principio de la Parte I y una especificación de la Parte II.*

**Booster: Impacta menos, transporta más.**
