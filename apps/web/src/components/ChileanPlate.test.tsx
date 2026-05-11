import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ChileanPlate } from './ChileanPlate.js';

describe('ChileanPlate', () => {
  describe('rendering', () => {
    it('renderiza patente canónica con separadores en aria-label', () => {
      render(<ChileanPlate plate="PTCL23" />);
      expect(screen.getByLabelText('Patente PT·CL·23')).toBeInTheDocument();
    });

    it('normaliza input con separadores y minúsculas', () => {
      render(<ChileanPlate plate="bc·df·12" />);
      expect(screen.getByLabelText('Patente BC·DF·12')).toBeInTheDocument();
    });

    it('renderiza "CHILE" como texto inferior', () => {
      const { container } = render(<ChileanPlate plate="PTCL23" />);
      const chileText = Array.from(container.querySelectorAll('text')).find(
        (el) => el.textContent === 'CHILE',
      );
      expect(chileText).toBeTruthy();
    });

    it('renderiza los 3 grupos de la patente en SVG', () => {
      const { container } = render(<ChileanPlate plate="BCDF12" />);
      const texts = Array.from(container.querySelectorAll('text')).map((el) => el.textContent);
      expect(texts).toContain('BC');
      expect(texts).toContain('DF');
      expect(texts).toContain('12');
    });

    it('label custom sobrescribe el aria-label default', () => {
      render(<ChileanPlate plate="PTCL23" label="Mi camión favorito" />);
      expect(screen.getByLabelText('Mi camión favorito')).toBeInTheDocument();
    });

    it('patente inválida → muestra texto tal cual sin separadores', () => {
      const { container } = render(<ChileanPlate plate="XX" />);
      // No debería tener 3 grupos canónicos — solo el fallback text.
      const fallbackText = Array.from(container.querySelectorAll('text')).find(
        (el) => el.textContent === 'XX',
      );
      expect(fallbackText).toBeTruthy();
    });

    it('incluye <title> para tooltip nativo', () => {
      const { container } = render(<ChileanPlate plate="PTCL23" />);
      const title = container.querySelector('title');
      expect(title?.textContent).toBe('Patente PT·CL·23');
    });
  });

  describe('sizes', () => {
    it('size sm aplica w-24', () => {
      const { container } = render(<ChileanPlate plate="PTCL23" size="sm" />);
      const wrapper = container.querySelector('[aria-label="Patente PT·CL·23"]');
      expect(wrapper?.className).toContain('w-24');
    });

    it('size md (default) aplica w-40', () => {
      const { container } = render(<ChileanPlate plate="PTCL23" />);
      const wrapper = container.querySelector('[aria-label="Patente PT·CL·23"]');
      expect(wrapper?.className).toContain('w-40');
    });

    it('size lg aplica w-64', () => {
      const { container } = render(<ChileanPlate plate="PTCL23" size="lg" />);
      const wrapper = container.querySelector('[aria-label="Patente PT·CL·23"]');
      expect(wrapper?.className).toContain('w-64');
    });
  });

  describe('interactive', () => {
    it('sin onClick → renderiza como <div>', () => {
      const { container } = render(<ChileanPlate plate="PTCL23" />);
      expect(container.querySelector('button')).toBeNull();
      expect(container.querySelector('div')).toBeTruthy();
    });

    it('con onClick → renderiza como <button>', () => {
      render(<ChileanPlate plate="PTCL23" onClick={vi.fn()} />);
      expect(screen.getByRole('button', { name: 'Patente PT·CL·23' })).toBeInTheDocument();
    });

    it('click en botón dispara onClick', async () => {
      const handler = vi.fn();
      render(<ChileanPlate plate="PTCL23" onClick={handler} />);
      await userEvent.click(screen.getByRole('button'));
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });
});
