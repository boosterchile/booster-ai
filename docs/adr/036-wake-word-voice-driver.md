# ADR-036 — Wake-word voice activation para el conductor ("Oye Booster")

**Status**: Accepted
**Date**: 2026-05-13
**Decider**: Felipe Vicencio (Product Owner)
**Related**: [ADR-008 PWA multirol](./008-pwa-multirole.md), plan `docs/plans/2026-05-12-identidad-universal-y-dashboard-conductor.md` (Wave 5), research `docs/research/2026-05-13-cultura-conductor-chileno.md`

---

## Contexto

Felipe (2026-05-12):

> "El comando por voz debería activarse como Alexa o Siri."

Hoy las features voice del conductor (Phase 4: confirmar entrega, marcar incidente, aceptar oferta, cancelar) requieren **push-to-talk explícito**: el conductor tiene que mirar la pantalla, encontrar el botón de mic, tocarlo, hablar. Esto contradice la promesa "sin tocar la pantalla mientras conduces" del Modo Conductor — y para tocar el botón el conductor ya se distrajo.

La solución natural: wake-word always-on que despierta el flow voice. "Oye Booster" → app empieza a escuchar el comando.

## Decisión

Integrar **Picovoice Porcupine** como motor de wake-word on-device. Wake-word custom **"Oye Booster"** entrenado en español neutro + dialectos chilenos. Activable opt-in desde `/app/conductor/configuracion`, default OFF.

### Por qué Porcupine

- **On-device**: el modelo corre en el browser (WebAssembly). El audio del wake-word NO sale del dispositivo. Privacy by design.
- **Footprint mínimo**: ~700 KB JS + ~50 KB modelo .ppn por wake-word.
- **Latencia**: ~50 ms de detección post-trigger.
- **Custom wake-words**: Picovoice Console permite entrenar "Oye Booster" con 24h de training time. Costo: ~$20/mes por wake-word custom hasta cierto volumen, $99/mes para producción.
- **Alternativas descartadas**:
  - Snowboy: deprecada en 2020.
  - Mycroft Precise: abandonada en 2023.
  - Voicemod / Speechly: cloud-based, contradicen privacy.
  - WebRTC + speech-to-text Whisper: costo cloud y latencia inaceptable.

### Por qué "Oye Booster"

Validado en research note 2026-05-13:

- "Oye" es iniciador conversacional chileno natural.
- Dos sílabas fonéticamente distintas → baja false positive rate.
- No colide con Siri/Alexa/Google.
- Pronunciable por dejos regionales (norte/centro/sur).

### Activación condicionada — battery-friendly

El wake-word listener consume CPU + mic constantes. Para preservar batería en conductores que operan 8–12h:

- **Solo activo cuando el vehículo está detenido** (≤3 km/h por 4 s, mismo gate del audio coaching).
- Cuando el vehículo comienza a moverse → mic pause automático.
- Cuando la pantalla está apagada → mic pause automático.
- Cuando el browser está en background tab → mic pause automático.

### Privacy garantías

Banner explícito en la primera activación + sección "Cómo funciona" en `/app/conductor/configuracion`:

> Booster solo escucha la frase "Oye Booster". El audio no se graba, no sale de tu teléfono, no se envía a Booster ni a ningún servidor. Solo cuando reconocemos la frase activamos el micrófono para que dictes tu comando, y ahí sí enviamos el audio del comando a Booster para procesarlo. Puedes desactivar esto en cualquier momento desde la configuración.

Esta promesa es **verificable**: Porcupine corre en WASM en el browser; no hay endpoint de transmisión de audio durante el listen. Booster puede demostrarlo abriendo DevTools Network.

### Opt-in y descubrimiento

- Default OFF: respetamos la decisión del conductor.
- Toggle visible en `/app/conductor/configuracion` → card nueva "Activación por voz".
- Onboarding: al primer login post-Wave 5, mostrar un dialog opcional "¿Activar la opción de voz? Ayuda a no tocar el celular mientras manejas." con CTA "Probar" + "No, gracias".
- Estado persistido en localStorage (mismo patrón que `loadAutoplayPreference`).
- Cuando ON, banner persistente en `/app/conductor` con icono de mic activo + countdown a próximo "Oye Booster".

### Feature flag

- `WAKE_WORD_VOICE_ACTIVATED` (server-side + cliente):
  - `false` (default): la card "Activación por voz" en configuración aparece como "Próximamente"; toggle deshabilitado.
  - `true`: la card está activa.
- Cliente lo lee desde `/me/feature-flags` (mismo endpoint público que el resto de flags Wave 4).
- Rollout staged: dev → staging por 7 días → prod.

### Custom wake-word training

Pendiente para producción (no bloquea PR 1):

1. Crear cuenta Picovoice Console + API key (Felipe lo hace).
2. Definir "Oye Booster" en Console.
3. Entrenar con 24h de training time (Picovoice usa TTS sintético + augmentación).
4. Validar accuracy con muestras propias chilenas (3 voces de Van Oosterwyk).
5. Descargar `.ppn` model file → commitear a `apps/web/public/wake-word/oye-booster-cl.ppn`.

Mientras tanto, el código se desarrolla con el modelo built-in "Bumblebee" (English) para pruebas. **NO mergeamos a prod sin el modelo custom**.

---

## Alternativas consideradas

### Alt 1 — Reusar Web Speech API en modo continuo

**Rechazada**. Web Speech API requiere user gesture cada activación de microphone permission. No es always-on real. Y en Android Chrome no funciona bien en background.

### Alt 2 — Botón flotante grande siempre visible

**Rechazada**. Felipe específicamente quiere "como Alexa o Siri". Botón flotante sigue requiriendo tocar la pantalla.

### Alt 3 — Bluetooth headset con botón físico

**Rechazada**. Asume hardware específico que no todos los conductores tienen. Bonus track para el roadmap.

### Alt 4 — TensorFlow.js + entrenar wake-word nosotros

**Rechazada**. Costo de ingeniería + datos de training >> $99/mes de Picovoice. No es nuestro core business.

---

## Consecuencias

### Positivas

- Driver puede operar la app realmente sin tocar la pantalla.
- Diferenciador competitivo vs TMS chilenos (ninguno tiene wake-word hoy).
- Privacy verificable: audio no sale del dispositivo.
- Battery-friendly: solo activo cuando el vehículo está parado.

### Negativas

- Dependencia comercial con Picovoice ($99/mes + training fee del wake-word custom).
- False positives en conversaciones casuales que mencionen "booster" (raro en contexto driver, pero posible).
- Browsers viejos sin WebAssembly SIMD: degradación a "no wake-word" + UI hint para upgrade.
- Costo operacional de mantener el modelo entrenado (re-train si cambia el dialecto target).

### Acciones derivadas

- Wave 5 PR 1 (este branch): foundation — service wrapper + hook + UI card + feature flag.
- Wave 5 PR 2 (post-training del wake-word custom): swap modelo built-in por el custom `.ppn`.
- Bonus Wave futura: bluetooth headset button + multiple wake-words por idioma del driver.

### Costo

- Picovoice license: $99/mes para producción ilimitada (Free tier es 3 usuarios activos/mes — no nos sirve).
- Custom wake-word training: $0 (incluido en license).
- Re-training si cambia accent target: $0 (mismo proceso self-service).

Total: **~$1200/año** — pequeño vs el valor agregado al conductor.
