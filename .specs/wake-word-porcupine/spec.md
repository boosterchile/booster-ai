# Spec — Wake-word "Oye Booster" con Picovoice Porcupine (T10-22, ADR-036)

**Contrato**: [ADR-036](../../docs/adr/036-wake-word-voice-driver.md). Este documento es el plan; el ADR manda.
**Programa**: TRL 10 (ADR-082, en revisión en boosterchile/booster-ai#742). Criterio T10-22: un controlador real de Picovoice reemplaza el stub de `apps/web/src/services/wake-word.ts` y se activa con flag sin nuevo deploy. Evidencia: un test que carga el controlador con el flag encendido y una prueba en un dispositivo.

## Entradas

- **Flag** `WAKE_WORD_VOICE_ACTIVATED`: ya existe en `config.ts` y `compute.tf`, y se expone en `GET /feature-flags`.
- **Preferencia del conductor**: `isWakeWordEnabled()`, guardada en `localStorage` (`services/wake-word-preference.ts`).
- **Picovoice**, a cargo del PO (ADR-036 §Custom wake-word training):
  - AccessKey de la Picovoice Console;
  - keyword `oye-booster-cl.ppn` entrenada en español;
  - modelo de parámetros `porcupine_params_es.pv` (público, del repositorio de Picovoice).
- **SDK**: `@picovoice/porcupine-web@4.0.1` y `@picovoice/web-voice-processor@4.0.10`, ambos con carga diferida.

## Salidas

1. **API `GET /me/wake-word`**:
   - Requiere sesión y `userContext`; la clasificación default-deny es ENFORCED.
   - Responde `{ disponible: true, access_key, keyword_url, model_url, sensibilidad }` solo si se cumplen las tres condiciones:
     - el flag está encendido;
     - hay AccessKey real (el placeholder `ROTATE_ME_` cuenta como ausente);
     - están configuradas las dos URLs de modelo.
   - En otro caso responde `{ disponible: false, motivo }`, con `motivo` igual a `flag_apagado | sin_access_key | sin_modelo`.
   - Por qué un endpoint: la AccessKey y las URLs de modelo se leen en runtime. Así el PO activa el wake-word cargando la clave en Secret Manager, subiendo los modelos y encendiendo el flag, **sin rebuild de la web ni deploy de código**. Si fueran variables `VITE_*`, cada cambio exigiría rebuild.
   - La AccessKey de Picovoice para web está diseñada para vivir en el navegador: el SDK la usa en el cliente. El endpoint autenticado evita publicarla en el bundle estático.
   - Span OTel y métrica `wake_word.config_servida`, con el atributo `disponible`.
2. **Controlador real** en `services/wake-word.ts` (`PorcupineWakeWordController`), que reemplaza al stub con la misma interfaz `WakeWordController`:
   - `init`: si falta la clave o el modelo, o el navegador no tiene WebAssembly, pasa a `unavailable`. Si no, carga el SDK con `import()` y crea un `PorcupineWorker` con la keyword custom y el modelo. Termina en `idle`, sin tocar el micrófono.
   - `enable`: suscribe el worker a `WebVoiceProcessor`, con lo que pide el micrófono y pasa a `listening`.
   - `pause` y `resume`: desuscriben y vuelven a suscribir. Cuando está pausado, el micrófono queda liberado. `resume` solo reactiva si `enable` estaba pedido.
   - `disable`: desuscribe y pasa a `idle`.
   - `destroy`: desuscribe, libera y termina el worker.
   - **Detección**: emite `detection` y llama a `onWake`. Además se desuscribe durante `pausaTrasDeteccionMs` (8 s por omisión), para que el reconocedor de comandos (Web Speech) tenga el micrófono libre, y luego reanuda si sigue habilitado y sin gate.
   - **Errores**: un fallo de carga o de proceso emite `error` y pasa a `error`. Ningún `catch` traga el error en silencio.
   - El SDK es inyectable (`cargarSdk`), así que los tests no cargan WASM.
3. **Activación en `/app/conductor`**:
   - Con el flag y la preferencia encendidos, el banner pide `/me/wake-word`, monta `useWakeWord` y llama a `enable()`.
   - **Gates de ADR-036 §Activación condicionada**:
     - pausa con el vehículo en movimiento (`createStoppedDetector`; `stopped` reanuda);
     - pausa con la pestaña oculta (`visibilitychange`).
   - **Texto del banner según el estado real**:
     - "Escuchando «Oye Booster»" solo en `listening`;
     - "Micrófono en pausa: el vehículo está en movimiento" en `paused`;
     - el texto de "todavía lo estamos preparando" cuando no está disponible.
   - El banner nunca afirma que escucha si el micrófono no está activo.
4. **Del wake-word al comando**: un bus mínimo (`services/wake-word-bus.ts`) entrega cada detección al último `VoiceCommandButton` montado, que arranca su reconocimiento como si el conductor lo hubiera tocado. Sin botón de voz en pantalla, la detección no hace nada más que registrarse.
5. **Terraform**, sin IAM: el secreto `picovoice-access-key` (con un placeholder `ROTATE_ME_` y `ignore_changes`), más las env `PICOVOICE_ACCESS_KEY`, `WAKE_WORD_KEYWORD_URL` y `WAKE_WORD_MODEL_URL` en el api. El SA runtime ya tiene `secretAccessor` a nivel proyecto.

## Activación (a cargo del PO, sin deploy de código)

1. Cargar la AccessKey: `echo -n "<key>" | gcloud secrets versions add picovoice-access-key --data-file=-`.
2. Subir `oye-booster-cl.ppn` y `porcupine_params_es.pv` a una ruta pública con CORS hacia la web, y fijar `wake_word_keyword_url` y `wake_word_model_url` en tfvars. También sirve `apps/web/public/wake-word/` con un deploy de la web.
3. `wake_word_voice_activated = true`.
4. Prueba en un dispositivo Android con Chrome: detección, pausa en movimiento y comando por voz posterior. Registrar el resultado en `docs/handoff/` (evidencia T10-22).

## Desviaciones declaradas

- ADR-036 dice que el cliente lee el flag desde `/me/feature-flags`. El endpoint real es `GET /feature-flags`, y no cambia.
- ADR-036 propone commitear el `.ppn` en `apps/web/public/wake-word/`. Aquí la URL es configurable y esa ruta queda como una opción más, para no exigir deploy.
- ADR-036 menciona la pausa por "pantalla apagada". El navegador no expone ese estado; `visibilitychange` lo cubre, porque al apagar la pantalla la página pasa a `hidden`.

## Criterios de éxito

- [ ] Rojo exhibido antes de implementar en el controlador (ciclo de vida, detección y pausas), en la ruta API y en el bus.
- [ ] Un test carga el controlador con el flag encendido: banner, `/me/wake-word` disponible, SDK falso, estado `listening` y `onWake` que llega al botón de voz.
- [ ] Sin clave, sin modelo o sin WASM, el estado es `unavailable` y nunca se pide el micrófono.
- [ ] Coverage ≥ 80 % en el código nuevo; lint, typecheck y build; default-deny; `terraform validate` y `fmt`.
- [ ] Fuera del código, a cargo del PO: AccessKey, modelo entrenado y prueba en un dispositivo.
