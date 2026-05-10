/**
 * Banner discreto que invita al user a activar Web Push notifications.
 *
 * Se muestra cuando:
 *   - Browser soporta Web Push (isWebPushSupported()).
 *   - Notification.permission === 'default' (no fue ni concedido ni denegado).
 *   - El user no dismisseó el banner en esta sesión (sessionStorage flag).
 *
 * Se oculta cuando:
 *   - Permission ya está 'granted' o 'denied' (no tiene sentido mostrarlo).
 *   - Browser no soporta Web Push.
 *   - El user dismisseó (clickeó X) en esta sesión.
 *
 * Diseño: amber-light banner inline, no modal — no interrumpe el flujo
 * del chat. Si el user lo ignora 100 veces seguidas, no es nuestro problema.
 */

import { useMutation } from '@tanstack/react-query';
import { Bell, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { logger } from '../../lib/logger.js';
import {
  PushDisabledError,
  PushPermissionDeniedError,
  isWebPushSupported,
  subscribeToWebPush,
} from '../../lib/web-push.js';

const DISMISS_FLAG = 'booster.pushBanner.dismissed';

export function PushSubscribeBanner() {
  const [shouldShow, setShouldShow] = useState(false);

  useEffect(() => {
    if (!isWebPushSupported()) {
      return;
    }
    if (Notification.permission !== 'default') {
      return;
    }
    if (sessionStorage.getItem(DISMISS_FLAG) === '1') {
      return;
    }
    setShouldShow(true);
  }, []);

  const subscribeM = useMutation({
    mutationFn: subscribeToWebPush,
    onSuccess: () => setShouldShow(false),
    onError: (err) => {
      if (err instanceof PushPermissionDeniedError) {
        // User dijo no — no insistimos en esta sesión.
        sessionStorage.setItem(DISMISS_FLAG, '1');
        setShouldShow(false);
      } else if (err instanceof PushDisabledError) {
        // Server sin VAPID — el banner no aporta. Suprimir.
        sessionStorage.setItem(DISMISS_FLAG, '1');
        setShouldShow(false);
      } else {
        logger.warn({ err }, 'subscribeToWebPush error');
      }
    },
  });

  if (!shouldShow) {
    return null;
  }

  const onDismiss = () => {
    sessionStorage.setItem(DISMISS_FLAG, '1');
    setShouldShow(false);
  };

  return (
    <div className="flex items-center gap-3 border-amber-200 border-b bg-amber-50 px-4 py-2">
      <Bell className="h-4 w-4 shrink-0 text-amber-700" aria-hidden />
      <p className="flex-1 text-amber-900 text-sm">
        Activa las notificaciones para enterarte cuando la otra parte te escriba, incluso con la app
        cerrada.
      </p>
      <button
        type="button"
        onClick={() => subscribeM.mutate()}
        disabled={subscribeM.isPending}
        className="rounded-md bg-amber-600 px-3 py-1 font-medium text-white text-xs hover:bg-amber-700 disabled:opacity-60"
      >
        {subscribeM.isPending ? 'Activando…' : 'Activar'}
      </button>
      <button
        type="button"
        onClick={onDismiss}
        className="rounded p-1 text-amber-700 hover:bg-amber-100"
        aria-label="Descartar banner"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
