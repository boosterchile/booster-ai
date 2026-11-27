import { describe, expect, it } from 'vitest';
import {
  PROYECTO_STAGING,
  esBaseDeProd,
  exigirClaveNoPublicada,
  exigirDestinoStaging,
} from '../../scripts/seed-staging-e2e-guardas.js';

const ENV_OK = {
  SEED_E2E_DESTINO: 'staging',
  GOOGLE_CLOUD_PROJECT: PROYECTO_STAGING,
  DATABASE_URL: 'postgresql://app:x@127.0.0.1:5450/booster_ai',
};

describe('exigirDestinoStaging', () => {
  it('acepta el destino explícito, el proyecto de staging y una base por túnel', () => {
    expect(exigirDestinoStaging(ENV_OK)).toEqual({
      projectId: PROYECTO_STAGING,
      databaseUrl: ENV_OK.DATABASE_URL,
    });
  });

  it('exige SEED_E2E_DESTINO=staging: no hay destino implícito', () => {
    expect(() => exigirDestinoStaging({ ...ENV_OK, SEED_E2E_DESTINO: undefined })).toThrow(
      /SEED_E2E_DESTINO=staging/,
    );
    expect(() => exigirDestinoStaging({ ...ENV_OK, SEED_E2E_DESTINO: 'prod' })).toThrow(
      /SEED_E2E_DESTINO=staging/,
    );
  });

  it('rechaza cualquier proyecto que no sea el de staging, incluido prod', () => {
    expect(() =>
      exigirDestinoStaging({ ...ENV_OK, GOOGLE_CLOUD_PROJECT: 'booster-ai-494222' }),
    ).toThrow(/booster-ai-stg-494222/);
    expect(() => exigirDestinoStaging({ ...ENV_OK, GOOGLE_CLOUD_PROJECT: undefined })).toThrow(
      /GOOGLE_CLOUD_PROJECT/,
    );
  });

  it('rechaza el emulador de Auth: la cuenta tiene que quedar en Identity Platform', () => {
    expect(() =>
      exigirDestinoStaging({ ...ENV_OK, FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' }),
    ).toThrow(/emulador/);
  });

  it('exige DATABASE_URL', () => {
    expect(() => exigirDestinoStaging({ ...ENV_OK, DATABASE_URL: undefined })).toThrow(
      /DATABASE_URL/,
    );
  });
});

describe('exigirClaveNoPublicada', () => {
  it('acepta una clave de seis dígitos que no está en el repo', () => {
    expect(exigirClaveNoPublicada('730518', 'SEED_E2E_CLAVE_TRANSPORTISTA')).toBe('730518');
  });

  it('rechaza una clave ausente o que no son seis dígitos', () => {
    for (const mala of [undefined, '', '12345', '1234567', '12a456']) {
      expect(() => exigirClaveNoPublicada(mala, 'SEED_E2E_CLAVE_GENERADOR')).toThrow(
        /SEED_E2E_CLAVE_GENERADOR/,
      );
    }
  });

  it('rechaza las claves que están escritas en el repositorio público', () => {
    for (const publicada of ['482913', '135790', '864209', '246810']) {
      expect(() => exigirClaveNoPublicada(publicada, 'SEED_E2E_CLAVE_TRANSPORTISTA')).toThrow(
        /publicada/,
      );
    }
  });

  it('rechaza claves triviales: un solo dígito repetido o una escalera', () => {
    for (const trivial of ['000000', '777777', '123456', '654321']) {
      expect(() => exigirClaveNoPublicada(trivial, 'SEED_E2E_CLAVE_TRANSPORTISTA')).toThrow(
        /trivial/,
      );
    }
  });
});

describe('esBaseDeProd', () => {
  const RUTS = ['76900001-1', '76900002-K'];

  it('una base vacía o con solo las empresas de la siembra no es prod', () => {
    expect(esBaseDeProd([], RUTS)).toBe(false);
    expect(
      esBaseDeProd(
        [
          { razonSocial: 'Transportes Van Oosterwyk', rut: '76900001-1' },
          { razonSocial: 'Prueba Generador SpA', rut: '76900002-K' },
        ],
        RUTS,
      ),
    ).toBe(false);
  });

  it('si una de las razones sociales existe con otro RUT, es la empresa real: es prod', () => {
    expect(
      esBaseDeProd([{ razonSocial: 'Transportes Van Oosterwyk', rut: '11111111-1' }], RUTS),
    ).toBe(true);
  });
});
