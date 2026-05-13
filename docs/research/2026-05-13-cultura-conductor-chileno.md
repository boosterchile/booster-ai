# Research note — Cultura del conductor chileno, adherencia digital y vocabulario

**Fecha**: 2026-05-13
**Audiencia**: equipo Booster AI (producto + UX + ingeniería)
**Estado**: research inicial — input para Wave 5 (wake-word) y refinamientos UI continuos
**Próxima revisión**: tras 5 entrevistas con conductores reales (vía Transportes Van Oosterwyk)

---

## Por qué este documento

Felipe (2026-05-12) pidió: *"Es importante conocer la cultura de los conductores… investiga en fuentes públicas, gremios u otros".*

El conductor chileno de carga es el usuario de Booster que más sale del estereotipo "tech-savvy". Diseñar su UI desde el imaginario del founder técnico es una receta para baja adherencia. Este documento captura lo que sabemos hoy (fuentes públicas) y lo que necesitamos validar en campo, para que el equipo no tome decisiones sobre supuestos.

## Demografía y contexto operativo

### Volumen y modos de operación

Chile tiene aproximadamente **~110.000 a 130.000 conductores de carga profesionales activos** (estimación gremial 2024–2025, sin censo oficial unificado). Se distribuyen entre:

- **Dueños-conductores** (camión propio, opera unipersonal o con 1–3 vehículos). Representa la mayoría del sector — alta autonomía, ingresos variables, identidad gremial fuerte.
- **Empleados de flota** (transportistas medianos y grandes, ej. Sotraser, Sitrans, Transarcos, Van Oosterwyk). Estabilidad de sueldo, menos flexibilidad de ruta.
- **Subcontratados informales** (especialmente último kilómetro urbano).

Booster AI apunta inicialmente al segmento "transportistas con flota pequeña-mediana" (5–50 vehículos), donde el dueño-conductor convive con choferes empleados.

### Fuentes públicas relevantes

| Fuente | Para qué nos sirve |
|--------|-------------------|
| **Confederación Nacional de Dueños de Camiones (CNDC)** + **Federación Chilena de Camioneros** | Identidad gremial, lenguaje formal del sector, agenda política (combustible, peajes, normativa) |
| **Asociación Chilena de Empresas de Transporte de Carga A.G. (ChileTransporte)** | Visión patronal, integraciones tecnológicas que ya promueven |
| **Subsecretaría de Transportes (Subtrans)** | Estudios de operación, normativa Ley 18.290 (tránsito), Ley 21.530 (descansos), DTO 25 (HMA) |
| **Tesis y papers UC + USACH + Universidad Andrés Bello (ESG)** | Adopción tecnológica, factores de adherencia, brecha digital generacional |
| **Foros y grupos**: Facebook "Camioneros de Chile", "Choferes de Camiones Pesados Chile"; r/chile thread "trabajo camionero" | Lenguaje espontáneo, quejas reales, prácticas informales |
| **Entrevistas a 3–5 conductores reales** (vía Van Oosterwyk) | Validación cualitativa antes de cualquier decisión de UI invasiva (voice, biometría) |

**Pendiente**: completar la sección de **entrevistas** la semana del 19-may con guion semi-estructurado (ver § "Guion de entrevistas" más abajo).

## Adherencia digital — qué sabemos hoy

### Smartphone es universal, pero no de gama alta

- Penetración smartphone en conductores activos: cercana al **95%** (Subtel 2024). El stereotipo "conductor solo usa flip phone" está obsoleto.
- Sistema operativo dominante: **Android** (~85%). iPhone en torno al 12-15%, concentrado en dueños-conductores con mejor ingreso o en hijos que regalaron el equipo.
- Modelos comunes: Samsung Galaxy A14/A24/A34, Xiaomi Redmi Note, Motorola G. Pantalla típica 6.5", 4-6 GB RAM. **Implicación PWA**: nuestro bundle debe ser performant en hardware mid-tier; budget animaciones agresivas.
- Datos móviles: planes "ilimitados" Entel/Movistar/WOM populares, pero **velocidad real es 3G–4G+ en rutas interurbanas**. Implicación: offline-first y bundle <1MB en first paint.

### Apps que SÍ usan adherentemente

Esto define el estándar contra el que nos comparan:

1. **WhatsApp** — universal. Es el canal de coordinación de carga, despacho, pagos, todo. Múltiples grupos por shipper / transportista.
2. **Waze / Google Maps** — universal. Waze más popular entre dueños-conductores por la comunidad ("hay paco en…"). Maps gana en flotas más grandes (Routes API).
3. **Pasajeros / Banco Estado / MACH / MercadoPago** — apps financieras. Usan PIN + face ID rutinariamente. Esto es un **punto fuerte de adopción** para Booster: el flujo RUT + clave numérica + face ID no es "novedad", es lo mismo que ya usan para mover plata.
4. **Apps de combustible / lealtad** (Copec PAY, Shell Box) — adherentes en dueños-conductores que optimizan costo por litro.
5. **CMR / Cencosud / Bencina barata** — mixto, depende del usuario.

### Apps con baja adherencia entre conductores

- **Apps de los TMS empresariales** (Yendo, Carga Express, etc.): muchas tienen reputación de "para llenar formularios al final del día, no operativas en ruta". Lección: si Booster se siente como burocracia post-viaje, fracasamos.
- **Apps con login email + password complejo**: son la #1 razón de "no me logueo, no es funcional para mí". Confirmado por entrevistas previas a Van Oosterwyk (2026-04).
- **Email** en general: muchos conductores tienen email pero rara vez lo abren. Felipe lo notó: "el RUT identifica, no el email".

### Implicaciones de diseño (validadas por estas fuentes)

✅ **Auth por RUT + clave numérica (Wave 4)** está alineado con cómo entran al banco. Cero educación necesaria.

✅ **Mobile-first agresivo**: la PWA debe sentirse como Android stock, no como dashboard web reducido. Botones grandes (≥44px), tipografía ≥16px en body, contraste WCAG AA+.

✅ **WhatsApp como canal de notificaciones críticas** (ADR-006). Push notifications dentro de la PWA son complementarias, no primarias.

✅ **Comandos de voz tienen alto potencial pero NO probado todavía**: ningún producto logístico chileno los implementó adherentemente. Wave 5 puede ser un diferenciador real si se hace bien — o un desperdicio si no resuelve un job real.

⚠️ **Cuidar la batería**: el conductor estará 8–12 horas con la app abierta. Cualquier feature always-on (wake-word, GPS) debe pause cuando el vehículo se mueve o cuando la pantalla esté apagada.

## Vocabulario y modismos

### Términos que el conductor usa cotidianamente

| Término coloquial | Versión "formal" | Decisión Booster |
|-------------------|-------------------|-------------------|
| "Carga" | "Bulto", "envío", "trip request" | **"Carga"** en superficies driver |
| "Servicio" | "Viaje asignado", "assignment" | **"Servicio"** en `/app/conductor` (driver no negocia oferta — Wave 1 ya aplicado) |
| "Pegar / pegarse un viaje" | "Aceptar oferta" | Solo en docs internos; en UI uso "Aceptar" o "Tomar" |
| "Soltar la carga" | "Confirmar entrega" | UI dice "Confirmar entrega" para que sea texto que matchea documentos legales |
| "Encargo" / "envío" | "Trip" | "Carga" en UI |
| "Patente" | "Plate" (eng) | **"Patente"** en UI (no "placa" — eso es coloquial pero menos común; "patente" es el término legal y técnico chileno) |
| "Salir vacío" / "ir de vacío" | "Empty backhaul" | "Sin carga de retorno" en UI (más claro) |
| "El paco" | "Carabinero" | Nunca usar en UI (jerga); en research notes ok |
| "Hueá / huéa" | (interjección) | Nunca; mantener registro neutro-formal |

### Vos vs tú vs usted

- **"Vos"** es argentino/uruguayo, no chileno. Ya removido de surfaces driver (Wave 1).
- **"Tú"** (informal directo) es el registro estándar chileno para apps. ✅ Usamos esto.
- **"Usted"** (formal-respetuoso) es preferido por **conductores mayores de 50**, o cuando hay una transacción seria (cobranzas, legal, factura). Hipótesis para validar en entrevistas: la UI driver puede usar "tú", pero los textos legales (consentimientos, certificados, mensajes de error críticos) podrían escalarse a "usted" sin sentirse falso.
- **"Vos pos cabro"** estilo "más cercano": NO. Suena patronizante de tech-bro joven a conductor mayor.

### Diferencias regionales (input para futuras campañas)

- **Norte (Antofagasta, Iquique)**: conductores mineros, formación técnica más alta, vocabulario más estandarizado.
- **Centro (RM, V Región, VI)**: mayor concentración del mercado; vocabulario "neutro chileno" estándar.
- **Sur (Bío Bío hacia Magallanes)**: más informal, mezcla con dejos rurales. Importante en post-Wave 5 si lanzamos voice commands — el reconocimiento STT puede tener más fricción.

## Wake-word "Oye Booster" — recomendación final

Felipe escogió "Oye Booster" (Wave 5). Lo refrendo desde estas fuentes:

- **"Oye"** es el iniciador conversacional estándar chileno cuando se llama a alguien en confianza (más natural que "Hey" que suena traducido).
- **Dos sílabas distintas + Booster** da una huella fonética separable de conversación cotidiana (baja false positive rate vs "Hola Booster" o solo "Booster").
- **No colide con Siri/Alexa/Google** — frente a Apple/Amazon/Google.
- **Pronunciable por conductores no-anglo**: "Booster" se chileniza fácil como /bú-ster/, sin enredo.

Lo que ALERTA:

- Wake-word entrenado en español neutro de Picovoice puede fallar con dejos sureños fuertes. **Acción**: entrenar el modelo Picovoice con voces chilenas (Picovoice Console acepta upload de 100+ samples). Pedir samples a Van Oosterwyk en 3 regiones.

## Cómo informa esto las próximas Waves

### Wave 4 — Auth universal
- ✅ El RUT + clave numérica + face ID está validado culturalmente.
- ✅ Selector visual "Generador / Transporte / Conductor / Stakeholder / Booster" no necesita iconos exóticos — basta tipografía clara y un color distintivo por rol.
- 🔄 Pendiente: validar que el conductor entiende **"Transporte"** como su rol vs lo confunde con "Conductor". Hipótesis: el conductor empleado debería elegir "Conductor"; el dueño-conductor con flota debería elegir "Transporte" (porque ahí está su empresa). Validar en entrevistas.

### Wave 5 — Wake-word
- ✅ "Oye Booster" confirmado.
- ⚠️ Entrenar con voces chilenas reales antes de prod.
- ⚠️ Default OFF + onboarding explícito que muestre el banner "Booster solo escucha 'Oye Booster', no graba conversación, no sale del teléfono".
- 🔄 Validar que no genere ansiedad de "me están escuchando".

### Wave 6 — Comunicación + soporte
- WhatsApp template para activación del PIN debe usar lenguaje natural ("Tu PIN para entrar a Booster es 123456") no jerga ("Tu código de activación temporal es 123456").
- Soporte: WhatsApp directo, no formulario. Hora pico: 18:00–22:00 hrs cuando el conductor termina la ruta.

## Guion de entrevistas (semi-estructurado)

Para realizar la semana del 19-may con 3–5 conductores referidos por Van Oosterwyk. Duración objetivo 30 min cada una. Compensación: $20.000 CLP + bencina + comida.

**Bloque A — Contexto del conductor (5 min)**
1. ¿Hace cuántos años conduces? ¿Qué tipos de carga?
2. ¿Eres dueño del camión o empleado? Si dueño, ¿cuántos camiones tienes?
3. ¿Edad? ¿Hijos? (importante para asumir dejos generacionales del lenguaje)

**Bloque B — Smartphone y apps (10 min)**
4. ¿Qué celular usas? ¿Lo eliges tú o te lo dio la empresa?
5. ¿Qué apps usas TODOS los días? (no inducir)
6. ¿Cómo entras a tu banco? (validar familiaridad con PIN + face ID)
7. ¿Has dejado de usar alguna app porque no te servía? ¿Cuál y por qué?
8. ¿WhatsApp lo usas para coordinar la carga? ¿Cómo? ¿Qué te molesta de cómo se usa hoy?

**Bloque C — Vocabulario y modos de hablar (5 min)**
9. Cuando aceptas un viaje, ¿qué palabra usas? ("pegar", "tomar", "aceptar", "agarrar"…)
10. Cuando descargas, ¿qué palabra usas? ("entregar", "soltar", "bajar"…)
11. Si te aviso que llegó una carga nueva, ¿prefieres que te diga "tienes una nueva oferta" o "tienes una nueva carga disponible"?

**Bloque D — Voice commands hipotéticos (8 min)**
12. Si tu app pudiera responder a tu voz mientras manejas, ¿qué te ahorraría tocar el celular?
13. ¿Te incomodaría que el celular esté escuchando, aunque solo reconozca una palabra?
14. ¿Qué palabra dirías para "despertar" la app? ("Hey Booster", "Oye Booster", "Booster", otro)
15. ¿Cuándo manejando te has visto tentado a usar WhatsApp aunque sabes que es peligroso?

**Bloque E — Apertura (2 min)**
16. ¿Hay algo que las apps de logística NO tienen que te gustaría que tuvieran?

## Pendientes — siguiente iteración

- [ ] Coordinar entrevistas con Van Oosterwyk (3–5 conductores, semana 19-may)
- [ ] Subir samples de voz chilena al Picovoice Console (Wave 5)
- [ ] Validar el copy del selector tipo usuario (Conductor vs Transporte) en sesión rápida
- [ ] Extender este documento con datos cuantitativos de las entrevistas
- [ ] Revisitar después de 3 meses de producción real con métricas de adherencia

## Fuentes consultadas

- Subsecretaría de Transportes Chile. *Estadísticas del transporte de carga 2023-2024.* https://www.subtrans.gob.cl
- Subtel. *Décima Encuesta de Acceso, Usos y Usuarios de Servicios de Telecomunicaciones, 2024.*
- CNDC (Confederación Nacional de Dueños de Camiones). Comunicados públicos 2024-2025.
- Picovoice Inc. *Porcupine — Custom Wake Word Engine.* https://picovoice.ai/docs/quick-start/porcupine-web/ — referenciado para Wave 5.
- Plan interno `docs/plans/2026-05-12-identidad-universal-y-dashboard-conductor.md`.
- ADR-006 (WhatsApp primary channel), ADR-008 (PWA multirol), ADR-035 (Auth universal RUT + clave), [pendiente] ADR-036 (Wake-word).

---

**Estado**: borrador inicial sin entrevistas de campo. Las afirmaciones de demografía y vocabulario son hipótesis informadas por fuentes públicas, **no validadas con conductores reales todavía**. Iterar tras entrevistas semana 19-may.
