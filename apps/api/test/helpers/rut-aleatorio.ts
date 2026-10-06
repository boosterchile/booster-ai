import { randomInt } from 'node:crypto';

/**
 * RUT chileno aleatorio y válido, en forma canónica (`12345678-K`).
 *
 * Para fixtures de integración: `usuarios.rut` tiene índice único
 * (`uq_usuarios_rut`, migración 0058), así que dos tests que inserten el
 * mismo RUT fijo chocan con `23505`. El dígito verificador se calcula de
 * verdad (módulo 11) para que la fila pase cualquier validación posterior.
 */
export function rutAleatorio(): string {
  const body = randomInt(10_000_000, 99_999_999);
  return `${body}-${digitoVerificador(body)}`;
}

function digitoVerificador(body: number): string {
  let suma = 0;
  let factor = 2;
  for (const ch of String(body).split('').reverse()) {
    suma += Number(ch) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const resto = 11 - (suma % 11);
  if (resto === 11) {
    return '0';
  }
  if (resto === 10) {
    return 'K';
  }
  return String(resto);
}
