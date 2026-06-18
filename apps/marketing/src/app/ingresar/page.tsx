import { permanentRedirect } from 'next/navigation';

/**
 * `/ingresar` redirige server-side con 308 (permanente) al login de la app.
 * El sitio de marketing no autentica; el acceso vive en `app.boosterchile.com`
 * (ADR-010). Permanente (no client redirect ni 307) por SEO: los crawlers no
 * indexan `/ingresar` como página propia y siguen el destino canónico
 * (review P2-3). La URL va inline: Next prohíbe exports extra en un page.tsx.
 */
export default function IngresarPage(): never {
  permanentRedirect('https://app.boosterchile.com/login');
}
