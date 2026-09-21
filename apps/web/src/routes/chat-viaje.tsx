import { Link, useParams } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { ProtectedRoute } from '../components/ProtectedRoute.js';
import { ChatPanel } from '../components/chat/ChatPanel.js';

/**
 * /app/chat/:id — landing del deep-link de WhatsApp unread y Web Push.
 *
 * El chat in-app es el sistema de registro; WA/push solo avisan y traen
 * aquí. Autorización: el mismo `resolveChatAccess` del API (generador,
 * oficina o conductor de la assignment). Escritura la cierra el API con
 * 409 `chat_closed` tras entregado/cancelado; las superficies que conocen
 * el estado (conductor, oficina, track) además pasan `readOnly`.
 */
export function ChatViajeRoute() {
  return (
    <ProtectedRoute meRequirement="require-onboarded">
      {(ctx) => {
        if (ctx.kind !== 'onboarded') {
          return null;
        }
        return <ChatViajePage />;
      }}
    </ProtectedRoute>
  );
}

function ChatViajePage() {
  const { id: assignmentId } = useParams({ strict: false }) as { id: string };

  return (
    <div className="flex h-screen flex-col bg-neutral-50 pt-safe">
      <div className="flex items-center gap-3 border-neutral-200 border-b bg-white px-4 py-3">
        <Link
          to="/app"
          className="rounded p-1 text-neutral-500 hover:bg-neutral-100"
          aria-label="Volver"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </Link>
        <h1 className="font-semibold text-neutral-900">Chat del viaje</h1>
      </div>
      <div className="min-h-0 flex-1">
        <ChatPanel assignmentId={assignmentId} title="Chat del viaje" />
      </div>
    </div>
  );
}
