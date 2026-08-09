// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Switch } from '../../src/renderer/src/components/ui/switch';

describe('Switch', () => {
  afterEach(cleanup);

  it('styles the Radix checked and unchecked states and remains interactive', () => {
    const onCheckedChange = vi.fn();

    function ControlledSwitch() {
      const [checked, setChecked] = useState(false);

      return (
        <Switch
          aria-label="启用此账户"
          checked={checked}
          onCheckedChange={(nextChecked) => {
            setChecked(nextChecked);
            onCheckedChange(nextChecked);
          }}
        />
      );
    }

    render(<ControlledSwitch />);

    const control = screen.getByRole('switch', { name: '启用此账户' });
    const thumb = control.querySelector('[data-slot="switch-thumb"]');

    expect(control.getAttribute('data-state')).toBe('unchecked');
    expect(control.className).toContain('data-[state=unchecked]:bg-input');
    expect(thumb?.className).toContain('data-[state=unchecked]:translate-x-0');

    fireEvent.click(control);

    expect(onCheckedChange).toHaveBeenCalledWith(true);
    expect(control.getAttribute('data-state')).toBe('checked');
    expect(control.className).toContain('data-[state=checked]:bg-primary');
    expect(thumb?.className).toContain('data-[state=checked]:translate-x-[calc(100%-2px)]');
  });
});
