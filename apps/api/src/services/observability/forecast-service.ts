/**
 * Forecast lineal del gasto mensual.
 *
 * Algoritmo:
 *   forecastEndOfMonth = mtdCost / dayOfMonth × daysInMonth
 *
 * Edge cases manejados:
 * - dayOfMonth=1 → escalar a 30 días (cero información, valor "optimista")
 * - mtdCost ≤ 0 → forecast 0
 * - timezone: usa America/Santiago para evitar saltos a las 21:00 UTC
 *
 * Para el dashboard reporta:
 * - Forecast end-of-month (CLP)
 * - vs. budget (env var MONTHLY_BUDGET_USD × FX actual)
 * - Δ% (positivo = sobre budget, negativo = bajo budget)
 *
 * No tiene cache propio — la entrada `mtdCost` ya viene cacheada de
 * CostsService.getOverview().
 */

export interface ForecastResult {
  forecastClpEndOfMonth: number;
  budgetClp: number;
  variancePercent: number;
  /** Día del mes usado en el cálculo. */
  dayOfMonth: number;
  /** Días totales del mes en curso. */
  daysInMonth: number;
  /** Días que restan del mes. */
  daysRemaining: number;
}

export interface ForecastInputs {
  /** Costo acumulado mes a la fecha, en CLP. */
  mtdCostClp: number;
  /** Budget mensual en USD (env var MONTHLY_BUDGET_USD). */
  budgetUsd: number;
  /** Tipo de cambio actual CLP por USD. */
  clpPerUsd: number;
  /** Inyectable para tests (default = new Date()). */
  now?: Date;
}

export class ForecastService {
  forecast(inputs: ForecastInputs): ForecastResult {
    const now = inputs.now ?? new Date();
    const { dayOfMonth, daysInMonth, daysRemaining } = this.santiagoMonth(now);

    const safeMtd = Math.max(0, inputs.mtdCostClp);
    const safeDay = Math.max(1, dayOfMonth);
    const forecastClp = Math.round((safeMtd / safeDay) * daysInMonth);

    const budgetClp = Math.round(inputs.budgetUsd * inputs.clpPerUsd);
    const variancePercent =
      budgetClp > 0 ? Math.round(((forecastClp - budgetClp) / budgetClp) * 1000) / 10 : 0;

    return {
      forecastClpEndOfMonth: forecastClp,
      budgetClp,
      variancePercent,
      dayOfMonth,
      daysInMonth,
      daysRemaining,
    };
  }

  /**
   * Componentes del mes en America/Santiago. Importante: hacer el split
   * en zona horaria local del negocio para que `dayOfMonth` no salte
   * por timezone offset.
   */
  private santiagoMonth(now: Date): {
    dayOfMonth: number;
    daysInMonth: number;
    daysRemaining: number;
  } {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Santiago',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = fmt.formatToParts(now);
    const year = Number.parseInt(parts.find((p) => p.type === 'year')?.value ?? '0', 10);
    const month = Number.parseInt(parts.find((p) => p.type === 'month')?.value ?? '0', 10);
    const day = Number.parseInt(parts.find((p) => p.type === 'day')?.value ?? '0', 10);
    // Día 0 del mes siguiente = último día del mes actual.
    const daysInMonth = new Date(year, month, 0).getDate();
    return {
      dayOfMonth: day,
      daysInMonth,
      daysRemaining: Math.max(0, daysInMonth - day),
    };
  }
}
