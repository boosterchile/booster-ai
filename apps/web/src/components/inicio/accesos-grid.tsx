import { Card } from '@booster-ai/ui-components';
import { Link } from '@tanstack/react-router';
import type { NavItem } from '../nav-items.js';

/** Grilla móvil a partir de la navegación que ya usa el sidebar. */
export function AccesosGrid({ items }: { items: NavItem[] }) {
  const accesos = items.filter((item) => item.to !== '/app');
  if (accesos.length === 0) {
    return null;
  }
  return (
    <section
      aria-labelledby="inicio-accesos"
      data-testid="inicio-accesos"
      className="mt-6 md:hidden"
    >
      <h2
        id="inicio-accesos"
        className="mb-3 font-semibold text-neutral-500 text-xs uppercase tracking-wider"
      >
        Accesos
      </h2>
      <Card>
        <ul className="grid grid-cols-4 gap-1 p-2">
          {accesos.map((item) => {
            const Icono = item.icon;
            return (
              <li key={item.to}>
                <Link
                  to={item.to}
                  className="flex flex-col items-center gap-2 rounded-md px-1 py-3 text-center hover:bg-neutral-50"
                >
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-50 text-primary-700">
                    <Icono className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span className="font-medium text-neutral-800 text-xs leading-tight">
                    {item.label}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </Card>
    </section>
  );
}
