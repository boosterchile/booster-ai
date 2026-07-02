import { describe, expect, it, vi } from 'vitest';
import { noopMembershipPaymentGateway } from '../../src/services/membership-payment-gateway.js';

const noop = (): void => undefined;
const makeLogger = () => ({
  trace: noop,
  debug: noop,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: noop,
  child() {
    return this;
  },
});

describe('noopMembershipPaymentGateway — STUB (no mueve dinero)', () => {
  it('siempre devuelve pending_provider y gatewayRef null', async () => {
    const logger = makeLogger();
    const gateway = noopMembershipPaymentGateway(logger as never);
    const r = await gateway.cobrar({
      facturaId: 'fac-1',
      empresaId: 'emp-1',
      totalClp: 17_850,
      periodoMes: '2026-06',
      intento: 1,
    });
    expect(r.resultado).toBe('pending_provider');
    expect(r.gatewayRef).toBeNull();
  });

  it('loguea warn con event=membership.payment.stub_noop (cobro NO ejecutado, no silencioso)', async () => {
    const logger = makeLogger();
    const gateway = noopMembershipPaymentGateway(logger as never);
    await gateway.cobrar({
      facturaId: 'fac-1',
      empresaId: 'emp-1',
      totalClp: 17_850,
      periodoMes: '2026-06',
      intento: 2,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'membership.payment.stub_noop', facturaId: 'fac-1' }),
      expect.stringContaining('STUB'),
    );
  });
});
