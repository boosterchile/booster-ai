# 002 — Canal del coaching IA: voz, no WhatsApp

**Status**: Accepted
**Date**: 2026-05-10
**Decider**: Felipe Vicencio (Product Owner)
**Related**:
- [ADR-006 — WhatsApp como canal primario](../docs/adr/006-whatsapp-primary-channel.md)
- Phase 3 PR-J1 — `packages/coaching-generator` (generación de coaching IA)
- Phase 3 PR-J2 — persistencia + endpoint API del coaching
- Phase 3 PR-J3 — *cerrado sin merge* (despacho WhatsApp del coaching al transportista)

---

## Decisión

El coaching IA post-entrega se entrega al **conductor** durante (o
inmediatamente antes/después de) la conducción, vía **audio sintetizado
con UI mínima** en la PWA Booster. **NO** se envía por WhatsApp.

WhatsApp queda reservado para los casos en que efectivamente aporta
valor sin colisionar con la operación al volante:

| Canal | Audiencia | Caso de uso |
|---|---|---|
| **Voz/audio en PWA** | Conductor | Coaching IA durante el viaje, alertas hands-free |
| **WhatsApp** | Generador de carga | Confirmación de carga emparejada, ETA, certificado |
| **WhatsApp** | Transportista (manager) | Acceso a info de la carga asignada, oferta nueva |
| **WhatsApp** | Conductor ↔ destinatario | Comms 1:1 + tracking link compartido (à la Uber) |

## Contexto

Phase 3 originalmente especificaba 3 PRs: J1 (package), J2 (persist +
expose), J3 (delivery). El J3 se implementó como WhatsApp template
(`coaching_post_entrega_v1`) al dueño activo del transportista. Antes
del merge, el Product Owner identificó dos errores de canal:

1. **Audiencia equivocada**: el dueño activo del transportista no es
   siempre el conductor que generó el score. En fleets >1 vehículo, el
   manager recibiría coaching de manejos que no hizo. La señal pierde
   accionabilidad: el manager no puede "anticipar frenadas" — el
   conductor sí.

2. **Modalidad equivocada**: aún si el dueño es el conductor (caso
   owner-operator), está manejando. Leer un mensaje WhatsApp en ruta es
   peligroso (legalmente prohibido en Chile bajo Ley 18.290 art. 199 C)
   y operativamente impráctico.

El J3 se cerró sin merge. El PR-J3 nuevo redefine el delivery como voz
en la PWA con dos sub-modos:
- **Pre-viaje** (parado, motor encendido, app foreground): audio
  reproduce el coaching del viaje anterior + tip del próximo viaje.
- **Post-entrega** (parado, entrega confirmada): audio reproduce el
  coaching del viaje recién terminado, sin requerir touch.

## Trade-offs

### Voz en lugar de WhatsApp

| | Voz/audio PWA | WhatsApp template |
|---|---|---|
| **Hands-free al volante** | ✅ | ❌ — requiere mirar pantalla |
| **Llega aún sin app abierta** | ❌ — requiere app foreground o background | ✅ |
| **Personalización por driver** | ✅ — driver_id ↔ trip_id directo | ⚠️ — vía membership, asume 1:1 manager↔driver |
| **Costo por entrega** | ~$0.0001 (TTS Google Cloud Text-to-Speech) | ~$0.005 (WhatsApp Business utility template) |
| **Aprobación Meta** | No requiere | 24-48h por template, re-submit si cambia copy |
| **Multi-device** | Limitado a la PWA donde está logueado | Cualquier dispositivo con WhatsApp |
| **Friction onboarding** | Requiere permisos audio + app instalada | Solo número en E164 |

La voz pierde en cobertura (driver sin app no recibe nada) y gana en
todo lo operacionalmente crítico para el caso de uso. La cobertura se
mitiga: si el conductor está activamente despachando viajes en Booster,
la app está instalada por contrato del producto.

### Por qué no SMS / push notif

- **SMS**: requiere lectura visual; mismo problema que WhatsApp.
- **Push web**: solo notifica que hay coaching nuevo, no lo entrega. Si
  el driver tiene que abrir la app y leer, sigue siendo inseguro al
  volante. Útil como complemento ("hay coaching nuevo del viaje
  anterior") pero no como canal primario.

### Por qué Booster (no Google Assistant / Siri)

- Control sobre la voz (latencia, idioma chileno, vocabulario logístico).
- Sin dependencia de OS — Android Auto + iOS Voice tienen políticas que
  cambian. Web Speech API (`speechSynthesis`) está estandarizado y
  funciona en background tab.
- Re-uso del prompt y los focos de coaching ya implementados en PR-J1.

## Acciones derivadas

1. ✅ **Cerrar PR-J3 WhatsApp delivery** (PR #112). Hecho 2026-05-10.
2. **PR-J3 nuevo (en cola)**: voz delivery en PWA.
   - `apps/web/src/services/coaching-voice.ts`: wrapper sobre
     `speechSynthesis` con cola, mute by default, manual unmute persisted
     en localStorage.
   - `apps/web/src/components/scoring/CoachingVoicePlayer.tsx`: botón ▶
     único, play/replay, sin botones secundarios. Visible solo en estado
     'parado' (`navigator.geolocation.getCurrentPosition` con velocidad
     ≤3 km/h, o vehículo en `idle`).
   - Hands-free auto-play opt-in: el conductor activa una vez en
     onboarding driver-mode, y ahí en adelante la PWA reproduce
     automáticamente al detectar entrega confirmada con motor parado.
3. **Phase 4 redefinida**: era OR-Tools multi-stop (deferida 2027).
   Ahora es "voice-first driver UX" — speech delivery + comandos por voz
   limitados (confirmar entrega, marcar incidente, aceptar oferta urgente)
   con micrófono activado solo a comando del usuario.
4. **WhatsApp coaching para manager (futuro, opcional)**: si el manager
   pide visibilidad de fleet-level performance, se evalúa un digest
   semanal vía WhatsApp con score agregado por driver — diferente
   contenido y diferente template, no es lo mismo que el coaching
   individual.

## Métricas de éxito (a medir post-implementación)

- % de viajes entregados donde el coaching fue **escuchado** (audio playback
  ≥80% del mensaje completado).
- Score promedio del **siguiente viaje** del mismo conductor después de
  haber escuchado coaching ≥3 veces (proxy de "el feedback cambia
  comportamiento").
- Tasa de unmute manual: si <20% de drivers desactiva el mute por
  defecto, repensar la default policy.

## Refs

- Discusión Product Owner ↔ Claude 2026-05-10 (cierre PR #112)
- Ley 18.290 Tránsito Chile, art. 199 letra C (uso de teléfono al
  volante)
- Web Speech API: https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API
