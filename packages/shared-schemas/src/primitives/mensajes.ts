import { z } from 'zod';

/**
 * Mensajes de validación en español para los schemas que ve el usuario (TRK-005).
 * Copy: chileno neutro, corto y con "tú". Reemplazan los textos por defecto de zod.
 */
export const MENSAJES = {
  requerido: 'Completa este campo',
  correo: 'Ingresa un correo válido',
  url: 'Ingresa una URL válida, como https://…',
  opcion: 'Elige una opción válida',
  fecha: 'Ingresa una fecha válida (AAAA-MM-DD)',
  min: (n: number) => `Escribe al menos ${n} caracteres`,
  max: (n: number) => `Usa como máximo ${n} caracteres`,
};

/** Enum: «Completa este campo» si falta; «Elige una opción válida» si viene fuera de la lista. */
export const errorOpcion = (iss: { input?: unknown }) =>
  iss.input === undefined ? MENSAJES.requerido : MENSAJES.opcion;

const conMax = (s: z.ZodString, max?: number) =>
  max === undefined ? s : s.max(max, MENSAJES.max(max));

/** Texto obligatorio con largo mínimo y máximo opcional. */
export const textoEs = (min: number, max?: number) =>
  conMax(
    z
      .string({ error: MENSAJES.requerido })
      .min(min, min > 1 ? MENSAJES.min(min) : MENSAJES.requerido),
    max,
  );

/** Correo obligatorio. */
export const correoEs = (max?: number) =>
  conMax(z.string({ error: MENSAJES.requerido }).email(MENSAJES.correo), max);

/** URL obligatoria. */
export const urlEs = () => z.string({ error: MENSAJES.requerido }).url(MENSAJES.url);
