import { DEFAULT_SITE_CONFIG, type SiteConfig, siteConfigSchema } from '@booster-ai/shared-schemas';
import { useQuery } from '@tanstack/react-query';
import { getApiUrl } from '../lib/api-url.js';

/**
 * ADR-039 — hook que lee la configuración runtime publicada desde
 * `GET /public/site-settings` con cache de 5 minutos (TanStack Query
 * staleTime). Fallback al `DEFAULT_SITE_CONFIG` hardcoded cuando:
 *
 *   - El endpoint devuelve 404 (no hay versión publicada)
 *   - El response no pasa validación Zod
 *   - El fetch falla por network / timeout
 *
 * El hook nunca lanza — siempre devuelve un `SiteConfig` válido. Eso
 * evita que un fallo del API rompa el render de la home pública.
 */

interface PublicSiteSettingsResponse {
  version: number;
  config: SiteConfig;
  updated_at: string;
}

async function fetchPublicSiteSettings(): Promise<SiteConfig> {
  try {
    const res = await fetch(`${getApiUrl()}/public/site-settings`);
    if (!res.ok) {
      return DEFAULT_SITE_CONFIG;
    }
    const json = (await res.json()) as PublicSiteSettingsResponse;
    const parsed = siteConfigSchema.safeParse(json.config);
    return parsed.success ? parsed.data : DEFAULT_SITE_CONFIG;
  } catch {
    return DEFAULT_SITE_CONFIG;
  }
}

export function useSiteSettings(): { config: SiteConfig; isLoading: boolean } {
  const { data, isLoading } = useQuery({
    queryKey: ['public-site-settings'],
    queryFn: fetchPublicSiteSettings,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
  return { config: data ?? DEFAULT_SITE_CONFIG, isLoading };
}
