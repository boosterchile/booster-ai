import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/api-client.js';
import { UsoTab } from './UsoTab.js';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('UsoTab', () => {
  it('renderiza Twilio + Workspace cuando ambos available', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/admin/observability/usage/twilio') {
        return {
          available: true,
          balance: { balanceUsd: 42.5, balanceClp: 39_313, currency: 'USD' },
          usage: [
            {
              category: 'sms',
              description: 'SMS',
              usage: 500,
              usageUnit: 'messages',
              priceUsd: 10,
              priceClp: 9250,
            },
          ],
        };
      }
      if (path === '/admin/observability/usage/workspace') {
        return {
          available: true,
          totalSeats: 10,
          activeSeats: 9,
          suspendedSeats: 1,
          seatsBySku: { '1010020028': 9 },
          monthlyCostUsd: 108,
          monthlyCostClp: 99_900,
        };
      }
      return {};
    });

    render(<UsoTab />, { wrapper: wrapper() });
    await waitFor(() => expect(screen.getByText(/\$42\.50 USD/)).toBeInTheDocument());
    expect(screen.getByText('sms')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument(); // totalSeats
  });

  it('Twilio not configured → muestra estado unavailable', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/admin/observability/usage/twilio') {
        return { available: false, reason: 'twilio_credentials_not_configured' };
      }
      return { available: false, reason: 'DWD pending' };
    });
    render(<UsoTab />, { wrapper: wrapper() });
    await waitFor(() => {
      expect(screen.getByText('Twilio no configurado')).toBeInTheDocument();
      expect(screen.getByText('Workspace no configurado')).toBeInTheDocument();
    });
  });
});
