import type { Logger } from '@booster-ai/logger';
import { describe, expect, it, vi } from 'vitest';
import { LoggingSignupRequestNotifier } from './signup-request-email.js';

// T10 SEC-001 Sprint 2b — unit tests para LoggingSignupRequestNotifier
// (stub que loguea structured en lugar de enviar email real). Cubre las 3
// methods del SignupRequestNotifier interface + variantes con/sin reason.

function makeLogger() {
  const info = vi.fn();
  const noop = () => undefined;
  const logger = {
    trace: noop,
    debug: noop,
    info,
    warn: noop,
    error: noop,
    fatal: noop,
    child: () => logger,
  } as unknown as Logger;
  return { logger, infoSpy: info };
}

describe('LoggingSignupRequestNotifier', () => {
  it('notifyAdminsOfNewRequest loguea event signup-request.notify.admin con metadata segura', async () => {
    const { logger, infoSpy } = makeLogger();
    const notifier = new LoggingSignupRequestNotifier(logger);

    await notifier.notifyAdminsOfNewRequest({
      requestId: 'req-1',
      requesterEmailHashed: 'abc123',
      adminEmails: ['a@x.cl', 'b@x.cl'],
      correlationId: 'corr-1',
    });

    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'signup-request.notify.admin',
        correlationId: 'corr-1',
        requestId: 'req-1',
        requesterEmailHashed: 'abc123',
        recipients: 2,
      }),
      expect.stringContaining('notify admins'),
    );
  });

  it('notifyUserOfApproval loguea event signup-request.notify.user.approved con loginLinkUrl', async () => {
    const { logger, infoSpy } = makeLogger();
    const notifier = new LoggingSignupRequestNotifier(logger);

    await notifier.notifyUserOfApproval({
      requestId: 'req-2',
      userEmail: 'user@cliente.cl',
      loginLinkUrl: 'https://app.boosterchile.com/login',
      correlationId: 'corr-2',
    });

    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'signup-request.notify.user.approved',
        correlationId: 'corr-2',
        requestId: 'req-2',
        userEmail: 'user@cliente.cl',
        loginLinkUrl: 'https://app.boosterchile.com/login',
      }),
      expect.stringContaining('notify user of approval'),
    );
  });

  it('notifyUserOfRejection sin reason loguea event sin field reason', async () => {
    const { logger, infoSpy } = makeLogger();
    const notifier = new LoggingSignupRequestNotifier(logger);

    await notifier.notifyUserOfRejection({
      requestId: 'req-3',
      userEmail: 'user@cliente.cl',
      correlationId: 'corr-3',
    });

    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'signup-request.notify.user.rejected',
        correlationId: 'corr-3',
        requestId: 'req-3',
        userEmail: 'user@cliente.cl',
      }),
      expect.stringContaining('notify user of rejection'),
    );
    // Sin reason → field no se incluye.
    const payload = infoSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.reason).toBeUndefined();
  });

  it('notifyUserOfRejection con reason agrega el field al payload', async () => {
    const { logger, infoSpy } = makeLogger();
    const notifier = new LoggingSignupRequestNotifier(logger);

    await notifier.notifyUserOfRejection({
      requestId: 'req-4',
      userEmail: 'user@cliente.cl',
      reason: 'datos incompletos',
      correlationId: 'corr-4',
    });

    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'signup-request.notify.user.rejected',
        reason: 'datos incompletos',
      }),
      expect.any(String),
    );
  });

  it('notifyAdminsOfNewRequest con lista vacía loguea recipients=0 (no crash)', async () => {
    const { logger, infoSpy } = makeLogger();
    const notifier = new LoggingSignupRequestNotifier(logger);

    await notifier.notifyAdminsOfNewRequest({
      requestId: 'req-5',
      requesterEmailHashed: 'hash5',
      adminEmails: [],
      correlationId: 'corr-5',
    });

    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({ recipients: 0 }),
      expect.any(String),
    );
  });
});
