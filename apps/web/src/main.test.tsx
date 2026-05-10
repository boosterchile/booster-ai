import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const renderMock = vi.fn();
const createRootMock = vi.fn(() => ({ render: renderMock }));
vi.mock('react-dom/client', () => ({
  default: { createRoot: createRootMock },
  createRoot: createRootMock,
}));

vi.mock('./router.js', () => ({
  router: { __test__: 'router-stub' },
}));

vi.mock('./styles.css', () => ({}));

beforeEach(() => {
  vi.resetModules();
  createRootMock.mockClear();
  renderMock.mockClear();
  // Limpiar #root entre tests.
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('main.tsx', () => {
  it('monta React en #root', async () => {
    const root = document.createElement('div');
    root.id = 'root';
    document.body.appendChild(root);
    await import('./main.js');
    expect(createRootMock).toHaveBeenCalledWith(root);
    expect(renderMock).toHaveBeenCalledTimes(1);
  });

  it('throws si no existe #root', async () => {
    await expect(import('./main.js')).rejects.toThrow(/#root not found/);
  });
});
