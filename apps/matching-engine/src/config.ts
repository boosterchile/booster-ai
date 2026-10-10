import { z } from 'zod';

/**
 * Config de matching-engine (T10-21). Env validada con Zod al startup; con
 * config inválida el servicio se rehúsa a arrancar.
 */
const envSchema = z.object({
  /** URL *.run.app del propio servicio: `aud` exigido en el ID token. */
  OIDC_AUDIENCE: z.string().url(),
  /** SA autorizado a pedir rankings (el runtime del api). */
  ALLOWED_CALLER_SA: z.string().email(),
  /** Cloud Run inyecta PORT. */
  PORT: z
    .string()
    .default('8080')
    .transform((s) => Number.parseInt(s, 10))
    .pipe(z.number().int().min(1).max(65535)),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  NODE_ENV: z.enum(['development', 'production', 'staging', 'test']).default('production'),
});

export type Config = z.infer<typeof envSchema>;

export class InvalidConfigError extends Error {
  readonly issues: { path: string; message: string }[];
  constructor(issues: { path: string; message: string }[]) {
    super('Invalid environment configuration. Refusing to start.');
    this.name = 'InvalidConfigError';
    this.issues = issues;
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new InvalidConfigError(
      parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return parsed.data;
}
