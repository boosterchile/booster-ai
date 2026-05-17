# DESIGN.md — Brief de marca y producto Booster AI

Este documento es el contrato de diseño para todo lo visual de Booster AI.
Se carga como contexto al usar **Claude Design** (canvas Anthropic) para
generar prototipos consistentes con la marca, y lo lee también el equipo
de ingeniería al implementar.

> Última actualización: 2026-04-30 — pre-launch lunes 4-may.
> Sistema técnico: ver `packages/ui-tokens/`.

---

## 1. Identidad de marca

**Booster AI** es el marketplace B2B de logística sostenible de Chile.
Conecta empresas que generan carga (shippers) con transportistas
(carriers) optimizando rutas, retornos vacíos y certificando huella de
carbono bajo GLEC v3.0.

### Personalidad

| Atributo | Lo que ES | Lo que NO ES |
|---|---|---|
| **Confiable** | B2B serio, dinero involucrado, datos críticos | Casual, amigable-startup |
| **Eficiente** | Operacional, denso en información, decisiones rápidas | Espaciado para "respirar", scrolly storytelling |
| **Sustentable** | Verde maduro, certificación, métricas reales | Greenwashing, ilustraciones de árboles |
| **Tecnológico** | Datos, automatización, AI invisible | Hype tech, animaciones gratuitas |
| **Chileno** | Lenguaje local, RUT, comunas, regiones | Genérico LATAM o gringo |

### Tono de voz

- **Directo, sin jerga**. "Nueva carga" no "create cargo request".
- **2da persona singular ("vos"/"tú" según país, default `tú` en Chile)**.
  No usar "ustedes" formal.
- **Acción clara**. Botones en infinitivo o imperativo: "Aceptar oferta",
  "Crear carga", "Ver historial".
- **Errores empáticos pero específicos**. Mal: "Error de validación".
  Bien: "El RUT 12.345.678-9 no es válido. Revisá el dígito verificador."
- **Sin exclamaciones gratuitas**. Una "!" celebra una entrega real, no
  un click.

---

## 2. Personas

Booster sirve a **5 tipos de usuarios** distintos. Cada uno tiene
contexto, dispositivo y necesidades muy diferentes — no asumir un único
patrón de UX.

### 2.1 Shipper Dispatcher (Camila, 32)

- **Rol**: opera logística en una empresa que vende productos físicos
  (retail, distribución, agro, mayorista). No es la dueña, es operadora.
- **Empresa**: 50-500 empleados, oficina en Santiago.
- **Dispositivo**: Windows desktop con dos monitores, 8h/día. WhatsApp
  abierto en el celular.
- **Frecuencia**: 5-30 cargas/día publicadas.
- **Lo que quiere**: publicar la carga rápido, ver quién aceptó, saber
  si va a llegar a tiempo.
- **Lo que la frustra**: tener que llamar al transportista para saber
  dónde está, formularios largos, software lento.

### 2.2 Carrier Owner (Pedro, 47)

- **Rol**: dueño de empresa de transporte (1-20 camiones). Conduce uno,
  los otros con choferes contratados.
- **Empresa**: PyME familiar, oficina en zona sur de Santiago o regiones.
- **Dispositivo**: Android de gama media, navegador en el celular el 80%
  del tiempo. PC compartida en la oficina para temas administrativos.
- **Frecuencia**: 3-15 ofertas evaluadas/día. Acepta ~30% de las que
  recibe.
- **Lo que quiere**: ver ofertas que le calzan rápido (origen, destino,
  precio, fecha), aceptar con un click, que le avisen cuando hay carga
  para su zona.
- **Lo que lo frustra**: ofertas que no calzan con sus camiones,
  competir contra precios bajos de empresas grandes, tener que escribir
  mucho en el celular.

### 2.3 Driver (Hugo, 39)

- **Rol**: conductor empleado de un Carrier. No usa el sistema para
  decidir, solo para ejecutar trips asignados.
- **Dispositivo**: Android, conexión 4G en ruta, frecuentemente con baja
  señal.
- **Frecuencia**: 1-3 trips/día.
- **Lo que quiere**: ver el trip del día (origen, destino, contacto del
  shipper, contacto del receptor), reportar "recogí" / "entregué" con
  foto.
- **Lo que lo frustra**: apps que requieren login complejo, que se
  cuelguen sin señal, formularios largos para reportar status.

### 2.4 Platform Admin (Felipe, 35)

- **Rol**: staff de Booster. Ve todo el ecosistema, interviene cuando
  hay problemas, valida onboarding de empresas nuevas, resuelve disputas.
- **Dispositivo**: MacBook + monitor 27".
- **Frecuencia**: 8h/día con la consola admin abierta.
- **Lo que quiere**: dashboard denso con métricas en vivo, búsqueda
  rápida por tracking code / RUT / placa, intervención manual cuando
  el matching falla, herramientas de soporte (re-asignar, suspender).

### 2.5 Sustainability Stakeholder (Mariana, 41)

- **Rol**: oficial de sostenibilidad en una empresa cliente o auditor
  externo (ISO 14064). Lee, no opera.
- **Dispositivo**: laptop corporativa, navegador.
- **Frecuencia**: 1-2 visitas/semana, foco en reportes mensuales.
- **Lo que quiere**: dashboards de huella de carbono (tCO₂e por mes,
  por ruta, por cliente), exportar a PDF/CSV para reporte ESG, ver
  metodología.
- **Lo que la frustra**: dashboards bonitos pero sin metodología clara,
  números sin trazabilidad.

---

## 3. Patrones de UX por persona

### Shipper web

- Layout: navegación lateral colapsable + main column ancha.
- Pantallas core: "Nueva carga" (form 1-step con autocompletes
  geográficos), "Mis cargas" (tabla densa con filtros), "Detalle de
  trip" (timeline de eventos + mapa).
- Densidad: alta. Mostrar toda la info en una pantalla; scroll mínimo.

### Carrier web (mobile-first crítico)

- Layout: tabs inferior (Ofertas / Mis trips / Perfil). Pensar mobile
  primero — el carrier no abre el desktop salvo administrativo.
- Pantallas core: "Ofertas activas" (cards apilables con accept/reject),
  "Mis trips" (lista filtrable por estado), "Perfil" (vehículos + zonas).
- Densidad: media. Cards grandes con buttons de tap-target ≥ 44px.

### Driver mobile (post-launch — fuera de scope día 1)

- Layout: full screen, una acción a la vez.
- Pantallas core: "Trip de hoy", "Recoger" (con cámara), "Entregar"
  (cámara + firma).

### Admin

- Layout: dashboard denso — sidebar fija + main column con tabla +
  detail pane lateral.
- Densidad: máxima. Es para operadores que necesitan ver muchos datos
  rápido.

### Stakeholder ESG

- Layout: páginas tipo "reporte" con narrativa + visualizaciones.
- Densidad: media. Whitespace generoso, charts grandes, métodos
  citados.

---

## 4. Principios visuales

### Color

Ver `packages/ui-tokens/src/colors.ts` para la paleta completa.

- **Brand primary**: verde Booster `#1FA058` (`primary.500`). No
  Tailwind green-500 — es custom.
- **Neutrals cálidos** (no slate frío). UI de oficina chilena, no
  Silicon Valley.
- **Accent ámbar** `#F58A00` (`accent.500`) para urgencia (oferta por
  expirar, tracking en vivo, alertas).
- **Semántica**: success verde, warning ámbar, danger rojo, info azul.
  **NO reusar primary para success** — confunde marca con estado.

### Typografía

- Sans: **Inter** — variable, óptima para UI densa.
- Mono: **JetBrains Mono** — tracking codes, placas, IDs.
- Escala 1.25 modular desde 16px base.

### Spacing y densidad

- Mobile: tap-target 44px mínimo.
- Desktop: padding 16-24px en cards, gap 8-16px en grids.
- Tablas: filas de 40-48px alto. No filas de 32px (ilegible para datos).

### Radius

- Buttons + inputs: `radius.md` (8px).
- Cards: `radius.lg` (12px).
- Modals: `radius.xl` (16px).
- Pill (`radius.full`) **solo** para tags, badges, avatars.

### Shadows

Discretos. NO neumórficos, NO glass-morphism, NO drop-shadows pesadas.
Booster es serio.

### Iconografía

- Set: **Lucide Icons** (clean, consistent, MIT, abundante).
- Stroke: 1.5-2px.
- Tamaño default: 20px en UI, 16px en inline text, 24px en headers.

### Imagery

- Fotografía: real, chilena, no stock genérico. Camiones reales,
  conductores reales, paisaje chileno. Si no hay foto real, mejor sin
  foto.
- Ilustraciones: minimal, monocromas en `primary.500` o `neutral.700`.
  No mascots, no cartoons.

### Motion

- Duraciones cortas (120-320ms). Ver `packages/ui-tokens/src/duration.ts`.
- Easing default: `cubic-bezier(0.4, 0, 0.2, 1)`.
- Animaciones de confirmación: usar `easing.spring` para el "+1 trip
  completado".
- **Reduce motion respetado siempre** (`prefers-reduced-motion`).

---

## 5. Accesibilidad

- **WCAG 2.1 AA mínimo** en todo lo de end-user.
- Contrast ≥ 4.5:1 en texto, ≥ 3:1 en UI elements.
- Focus visible siempre (`shadow.focusRing`).
- Touch targets ≥ 44px en mobile.
- Labels asociadas con `for` / `aria-label`.
- Errores anunciados a screen readers (`aria-live`).
- Idioma `lang="es-CL"`.
- Formato de fecha/hora local Chile (`America/Santiago`,
  DD/MM/YYYY HH:mm).
- Formato monetario CLP sin decimales: `$ 250.000`.

---

## 6. Estado del producto

### Hoy (lunes 30-abr)

- **WhatsApp shipper intake** funcionando (Twilio + bot). Validado
  E2E con tracking BOO-M6LO3H.
- **API multi-tenant** con auth Firebase, schemas listos.
- **Web + marketing** = 0 LOC. **Construyendo ahora**.

### Lunes 4-may (launch piloto 20 carriers)

- Web carrier minimal: login → dashboard de ofertas → accept/reject →
  perfil con vehículos + zonas.
- Web admin minimal: lista de empresas, intervención manual,
  observabilidad.
- Onboarding empresa: 4 pasos (datos, tipo de operación, plan,
  confirmación).
- Marketing landing: hero + signup CTA + plans.

### Después del lunes (roadmap explícito)

- Driver mobile app
- Carrier perfil avanzado (verificación documentos, ratings)
- Shipper PWA completa (alternativa al WhatsApp para web users)
- Stakeholder ESG dashboard
- Stripe/Flow billing automático
- DTE + Carta de Porte automatizados

---

## 7. Cómo usar Claude Design para Booster

1. **Cargar contexto**: este `DESIGN.md` + el codebase entero. Claude
   Design lee `packages/ui-tokens/` para los tokens y este archivo para
   el brief de marca/personas.
2. **Pedir prototipos por persona específica**: nunca "una página de
   shipper", siempre "la pantalla de Nueva Carga para Camila (Shipper
   Dispatcher) en desktop". Mejor output cuando Claude Design tiene la
   persona + flow concreto.
3. **Iterar**: el primer prototipo difícilmente clave. Pedir
   correcciones específicas: "más denso, sigue siendo Camila", "agregá
   columna de huella CO₂", "este botón es secundario, debería ser
   ghost".
4. **Exportar handoff bundle**: cuando esté aprobado, exportar el bundle
   y mandarlo a Cowork (este repo). El agente lo aterriza contra
   `apps/web/` o `apps/marketing/` respetando los tokens y este brief.

---

## 8. No-do's de marca

- ❌ Verde turquesa o aqua (parece startup tech).
- ❌ Mascots, cartoons o ilustraciones infantiles.
- ❌ "Welcome aboard! 🚀" (gringo) — usar "Bienvenido" sin emoji.
- ❌ Background gradients pastel (no es producto creativo).
- ❌ Glassmorphism, neumorphism, brutalism.
- ❌ Iconografía 3D o emoji-style.
- ❌ Hablar de "magia", "wow", "experiencia mágica" — somos operación
  logística, no entretenimiento.
- ❌ Ilustraciones de árboles, hojas, planeta tierra para
  sustentabilidad. La sustentabilidad de Booster es **medida, no
  ilustrada** — números reales, no símbolos.
