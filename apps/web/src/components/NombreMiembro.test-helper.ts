import { screen } from '@testing-library/react';
import { expect } from 'vitest';
import { TEXTO_PENDIENTE } from './NombreMiembro.js';

/** Toda celda de un pendiente dice lo mismo y nunca queda vacía ni con «null». */
export async function esperarPendientesLimpios(): Promise<void> {
  const celdas = await screen.findAllByTestId('miembro-pendiente');
  for (const celda of celdas) {
    const texto = celda.textContent?.trim() ?? '';
    expect(texto.startsWith(TEXTO_PENDIENTE)).toBe(true);
    expect(texto).not.toMatch(/null|undefined|—/);
    expect(celda.firstElementChild?.textContent).toBe(TEXTO_PENDIENTE);
  }
}
