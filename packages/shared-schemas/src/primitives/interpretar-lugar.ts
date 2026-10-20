import type { RegionCode } from './chile.js';
import { comunaPorNombre, normalizarNombreLugar } from './comunas-chile.js';

/**
 * Traduce los address components de Google (Places o Geocoder) a región
 * canónica (I–XVI) y código de comuna CUT. El nombre de la región llega en
 * español o en inglés según el idioma de la cuenta.
 */
export interface ComponenteDireccion {
  longName: string;
  shortName: string;
  types: readonly string[];
}

export interface LugarInterpretado {
  direccion: string;
  region: RegionCode | null;
  comunaCode: string | null;
}

const REGLAS_REGION: ReadonlyArray<readonly [RegExp, RegionCode]> = [
  [/arica/, 'XV'],
  [/tarapaca/, 'I'],
  [/antofagasta/, 'II'],
  [/atacama/, 'III'],
  [/coquimbo/, 'IV'],
  [/valparaiso/, 'V'],
  [/nuble/, 'XVI'],
  [/biobio/, 'VIII'],
  [/araucania/, 'IX'],
  [/los rios/, 'XIV'],
  [/los lagos/, 'X'],
  [/aysen|aisen|ibanez/, 'XI'],
  [/magallanes/, 'XII'],
  [/higgins|libertador/, 'VI'],
  [/metropolitana|metropolitan/, 'XIII'],
  [/maule/, 'VII'],
];

export function regionDesdeNombre(nombre: string): RegionCode | null {
  const normalizado = normalizarNombreLugar(nombre);
  for (const [regla, codigo] of REGLAS_REGION) {
    if (regla.test(normalizado)) {
      return codigo;
    }
  }
  return null;
}

function componente(
  componentes: readonly ComponenteDireccion[],
  tipo: string,
): ComponenteDireccion | undefined {
  return componentes.find((item) => item.types.includes(tipo));
}

/**
 * Dirección legible + región + comuna. `formattedAddress` manda sobre la
 * calle armada por partes. Se saca el sufijo «, Chile».
 */
export function interpretarComponentes(
  componentes: readonly ComponenteDireccion[],
  formattedAddress: string,
): LugarInterpretado {
  const regionNombre = componente(componentes, 'administrative_area_level_1');
  let region = regionNombre ? regionDesdeNombre(regionNombre.longName) : null;

  let comunaCode: string | null = null;
  for (const tipo of ['administrative_area_level_3', 'locality', 'sublocality_level_1']) {
    const item = componente(componentes, tipo);
    if (!item) {
      continue;
    }
    const hallada = comunaPorNombre(item.longName, region) ?? comunaPorNombre(item.longName, null);
    if (!hallada) {
      continue;
    }
    comunaCode = hallada.code;
    region = region ?? hallada.region;
    break;
  }

  let direccion = formattedAddress.replace(/,\s*chile\s*$/i, '').trim();
  if (!direccion) {
    const calle = componente(componentes, 'route')?.longName;
    const numero = componente(componentes, 'street_number')?.longName;
    direccion = [calle, numero].filter((parte) => parte && parte.length > 0).join(' ');
  }

  return { direccion, region, comunaCode };
}
