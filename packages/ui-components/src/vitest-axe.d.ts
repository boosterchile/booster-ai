// Augment de tipos para el matcher `toHaveNoViolations` de vitest-axe. El
// `vitest-axe/extend-expect` que trae la lib augmenta el namespace global `Vi`
// (API vieja); vitest 4 lee el módulo `vitest`. El registro runtime del matcher
// vive en `vitest.setup.ts`.
declare module 'vitest' {
  // biome-ignore lint/suspicious/noExplicitAny: espeja `Assertion<T = any>` de vitest para el merge de declaración.
  interface Assertion<T = any> {
    toHaveNoViolations(): void;
  }
  interface AsymmetricMatchersContaining {
    toHaveNoViolations(): void;
  }
}

export {};
