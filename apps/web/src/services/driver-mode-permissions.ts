/**
 * Driver mode browser permissions (Phase 4 PR-K8 — onboarding driver-mode).
 *
 * El "modo conductor" de Booster combina varias features que requieren
 * permisos del browser:
 *
 *   - **Geolocation** (GPS): necesario para `stopped-detector`
 *     (auto-play coaching solo con vehículo parado) y para que la
 *     telemetría del teléfono complemente al Teltonika si está apagado.
 *   - **Microphone**: necesario para `voice-commands` (push-to-talk
 *     "aceptar oferta", "confirmar entrega", "marcar incidente",
 *     "cancelar"). Sin mic, los flujos hands-free no funcionan — solo
 *     queda el camino visual de botones.
 *
 * Este módulo encapsula la query del estado actual (`navigator.permissions`
 * cuando está disponible) + el side effect de "pedir" el permiso
 * (`getUserMedia` para mic, `getCurrentPosition` para geo). Devuelve
 * shapes simples consumibles por React sin importar `Permissions` types.
 *
 * **Diseño defensivo**:
 *   - `navigator.permissions.query` con `name: 'microphone'` no existe en
 *     todos los browsers (Safari < 16). El query() puede rechazar con
 *     `TypeError`. En ese caso devolvemos `'unknown'` — el usuario solo
 *     puede saber el estado real intentando obtener el stream.
 *   - `getUserMedia({ audio: true })` y `getCurrentPosition` ambos abren
 *     el prompt del browser si el state es `prompt`. Si está `denied`,
 *     fallan inmediatamente sin volver a preguntar — el usuario debe
 *     habilitarlo en settings del browser (instrucción mostrada en la UI).
 *   - Tras solicitar mic, **se cortan los tracks inmediatamente** — no
 *     mantenemos el mic abierto. La recognition real lo abrirá luego
 *     vía Web Speech API.
 */

export type PermissionStatus = 'granted' | 'denied' | 'prompt' | 'unsupported' | 'unknown';

export interface PermissionState {
  mic: PermissionStatus;
  geo: PermissionStatus;
}

/**
 * Lee el estado actual de los permisos. NO dispara prompts — solo
 * consulta. Útil para el render inicial de la pantalla.
 *
 * Devuelve `'unsupported'` si la Permissions API no existe.
 * Devuelve `'unknown'` si la API existe pero rechaza el query del nombre
 * (típicamente Safari con `'microphone'`).
 */
export async function queryDriverPermissions(opts?: {
  navigatorOverride?: Navigator;
}): Promise<PermissionState> {
  const nav = opts?.navigatorOverride ?? (typeof navigator !== 'undefined' ? navigator : null);
  if (!nav || typeof nav.permissions === 'undefined') {
    return { mic: 'unsupported', geo: 'unsupported' };
  }
  const mic = await safeQuery(nav.permissions, 'microphone');
  const geo = await safeQuery(nav.permissions, 'geolocation');
  return { mic, geo };
}

async function safeQuery(
  permissions: Permissions,
  name: 'microphone' | 'geolocation',
): Promise<PermissionStatus> {
  try {
    // Algunos browsers (Safari ≤16) tiran TypeError aquí para 'microphone'.
    // PermissionName es un tipo abierto en otros, así que casting puntual.
    const status = await permissions.query({ name: name as PermissionName });
    const s = status.state;
    if (s === 'granted' || s === 'denied' || s === 'prompt') {
      return s;
    }
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Pide el permiso de micrófono. Si está `granted`, resuelve sin prompt.
 * Si está `denied`, falla — el usuario debe habilitarlo en settings.
 * Si está `prompt`, dispara el prompt nativo del browser.
 *
 * Tras éxito, **cierra inmediatamente** los tracks del stream —
 * no mantenemos el mic abierto.
 *
 * Devuelve el nuevo estado, derivado del resultado:
 *   - Si getUserMedia resolvió → 'granted'
 *   - Si rechazó con NotAllowedError → 'denied'
 *   - Cualquier otro error → 'unknown'
 */
export async function requestMicrophonePermission(opts?: {
  mediaDevices?: MediaDevices;
}): Promise<PermissionStatus> {
  const md =
    opts?.mediaDevices ??
    (typeof navigator !== 'undefined' && typeof navigator.mediaDevices !== 'undefined'
      ? navigator.mediaDevices
      : null);
  if (!md || typeof md.getUserMedia !== 'function') {
    return 'unsupported';
  }
  try {
    const stream = await md.getUserMedia({ audio: true });
    // Stop tracks ASAP — solo queremos el handshake de permiso.
    for (const track of stream.getTracks()) {
      track.stop();
    }
    return 'granted';
  } catch (err) {
    if (err instanceof Error && err.name === 'NotAllowedError') {
      return 'denied';
    }
    return 'unknown';
  }
}

/**
 * Pide el permiso de geolocation. Llama `getCurrentPosition` una sola vez
 * — Maps API / stopped-detector usarán `watchPosition` después.
 *
 * Devuelve nuevo estado:
 *   - Resolved → 'granted'
 *   - PERMISSION_DENIED (1) → 'denied'
 *   - Cualquier otro error → 'unknown'
 */
export async function requestGeolocationPermission(opts?: {
  geolocation?: Geolocation;
}): Promise<PermissionStatus> {
  const geo =
    opts?.geolocation ??
    (typeof navigator !== 'undefined' && typeof navigator.geolocation !== 'undefined'
      ? navigator.geolocation
      : null);
  if (!geo || typeof geo.getCurrentPosition !== 'function') {
    return 'unsupported';
  }
  return new Promise<PermissionStatus>((resolve) => {
    geo.getCurrentPosition(
      () => resolve('granted'),
      (err) => {
        // GeolocationPositionError.PERMISSION_DENIED === 1
        if (err && err.code === 1) {
          resolve('denied');
        } else {
          resolve('unknown');
        }
      },
      // No options — query rápida; el watch real lo configura stopped-detector.
      { timeout: 8000, maximumAge: 60_000 },
    );
  });
}
