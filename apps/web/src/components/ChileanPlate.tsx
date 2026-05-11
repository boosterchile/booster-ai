import { formatPlateForDisplay, normalizePlate } from '@booster-ai/shared-schemas';

type Size = 'sm' | 'md' | 'lg';

const SIZE_WIDTH: Record<Size, string> = {
  sm: 'w-24',
  md: 'w-40',
  lg: 'w-64',
};

interface ChileanPlateProps {
  plate: string;
  size?: Size;
  /**
   * Si se provee, el componente se renderiza como `<button>` clickable.
   * Sin onClick → `<div>` decorativo.
   */
  onClick?: () => void;
  /**
   * Texto para screen readers / tooltip. Default: "Patente {formatted}".
   */
  label?: string;
  className?: string;
}

/**
 * Renderiza una patente chilena con el diseño visual oficial: marco negro
 * con esquinas redondeadas, fondo blanco, texto bold y escudo de Carabineros
 * como separador entre los grupos de letras (PT·CL·23).
 *
 * El input se normaliza con `normalizePlate`. Si la patente no es canónica
 * el componente muestra el texto tal cual sin separadores.
 */
export function ChileanPlate({ plate, size = 'md', onClick, label, className }: ChileanPlateProps) {
  const canonical = normalizePlate(plate);
  const display = formatPlateForDisplay(canonical);
  const ariaLabel = label ?? `Patente ${display}`;
  const widthClass = SIZE_WIDTH[size];

  const svg = (
    <svg
      viewBox="0 0 300 100"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      focusable="false"
      className="h-full w-full"
    >
      <title>{ariaLabel}</title>
      <rect
        x="3"
        y="3"
        width="294"
        height="94"
        rx="10"
        ry="10"
        fill="#FFFFFF"
        stroke="#0A0A0A"
        strokeWidth="6"
      />
      <PlateBody canonical={canonical} fallbackText={plate} />
      <text
        x="150"
        y="92"
        textAnchor="middle"
        fontFamily="Arial, Helvetica, sans-serif"
        fontSize="11"
        fontWeight="700"
        letterSpacing="2"
        fill="#0A0A0A"
      >
        CHILE
      </text>
    </svg>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel}
        className={`inline-block rounded-md outline-none transition hover:scale-[1.02] focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 ${className ?? ''}`}
      >
        <span className={`block aspect-[3/1] ${widthClass} select-none`}>{svg}</span>
      </button>
    );
  }

  return (
    <div
      role="img"
      aria-label={ariaLabel}
      className={`inline-block aspect-[3/1] ${widthClass} select-none ${className ?? ''}`}
    >
      {svg}
    </div>
  );
}

function PlateBody({ canonical, fallbackText }: { canonical: string; fallbackText: string }) {
  const fontFamily = 'Arial Black, "Helvetica Neue", Arial, sans-serif';
  const isCanonical = /^[A-Z]{4}\d{2}$/.test(canonical);

  if (!isCanonical) {
    return (
      <text
        x="150"
        y="63"
        textAnchor="middle"
        fontFamily={fontFamily}
        fontSize="40"
        fontWeight="900"
        fill="#0A0A0A"
      >
        {fallbackText.slice(0, 10)}
      </text>
    );
  }

  const group1 = canonical.slice(0, 2);
  const group2 = canonical.slice(2, 4);
  const group3 = canonical.slice(4);

  // Layout horizontal: PT [escudo] CL · 23
  //   x=46  → PT
  //   x=104 → escudo
  //   x=162 → CL
  //   x=210 → bullet
  //   x=252 → 23
  const fontSize = 50;
  return (
    <g fontFamily={fontFamily} fontWeight="900" fill="#0A0A0A">
      <text x="46" y="66" textAnchor="middle" fontSize={fontSize}>
        {group1}
      </text>
      <CarabinerosShield cx={104} cy={50} size={24} />
      <text x="162" y="66" textAnchor="middle" fontSize={fontSize}>
        {group2}
      </text>
      <circle cx="210" cy="50" r="4" fill="#0A0A0A" />
      <text x="252" y="66" textAnchor="middle" fontSize={fontSize}>
        {group3}
      </text>
    </g>
  );
}

/**
 * Escudo simplificado de Carabineros: óvalo oscuro con estrella blanca de
 * 5 puntas. Representación icónica — no es el logo oficial.
 */
function CarabinerosShield({ cx, cy, size }: { cx: number; cy: number; size: number }) {
  const rx = size / 2;
  const ry = (size * 1.15) / 2;
  const starPoints = fivePointStar(cx, cy, size * 0.42);
  return (
    <g>
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="#0A0A0A" />
      <polygon points={starPoints} fill="#FFFFFF" />
    </g>
  );
}

function fivePointStar(cx: number, cy: number, outerR: number): string {
  const innerR = outerR * 0.42;
  const points: string[] = [];
  for (let i = 0; i < 10; i += 1) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    points.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return points.join(' ');
}
