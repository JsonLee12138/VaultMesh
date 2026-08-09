// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Card, CardFooter } from '../../src/renderer/src/components/ui/card';

describe('Card', () => {
  afterEach(cleanup);

  it('does not reserve a header area when the footer is its only section', () => {
    render(
      <Card>
        <CardFooter>Actions</CardFooter>
      </Card>,
    );

    const footer = screen.getByText('Actions');
    const card = footer.parentElement;

    expect(card?.className).toContain('has-[>[data-slot=card-footer]:first-child]:pt-0');
    expect(footer.className).toContain('first:border-t-0');
  });
});
