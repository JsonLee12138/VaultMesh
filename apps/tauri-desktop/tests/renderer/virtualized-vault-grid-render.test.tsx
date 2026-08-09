// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { VirtualizedVaultGrid } from '../../src/renderer/src/components/VirtualizedVaultGrid';

const originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
let scrollOffset = 0;

beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1_280 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 240 });
  HTMLElement.prototype.getBoundingClientRect = () => ({
    bottom: 0, height: 0, left: 0, right: 0, top: -scrollOffset, width: 0, x: 0, y: -scrollOffset,
    toJSON: () => ({}),
  });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  });
});

afterEach(() => {
  scrollOffset = 0;
  cleanup();
});

afterAll(() => {
  if (originalOffsetHeight) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', originalOffsetHeight);
  HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('VirtualizedVaultGrid', () => {
  it('only mounts rows near the viewport for a large vault', async () => {
    const renderItem = vi.fn((index: number) => <article data-item-index={index} data-testid="vault-card">项目 {index + 1}</article>);
    render(
      <VirtualizedVaultGrid layoutKey="large-vault" sections={[{
        itemCount: 300,
        getItemKey: (index) => String(index),
        renderItem,
      }]} />,
    );

    await waitFor(() => expect(screen.getAllByTestId('vault-card').length).toBeGreaterThan(0));

    const renderedIndexes = new Set(renderItem.mock.calls.map(([index]) => index));
    const renderedRow = document.querySelector<HTMLElement>('[data-column-count="3"]');
    expect(renderedRow?.style.gridTemplateColumns).toBe('repeat(3, minmax(0, 1fr))');
    expect(renderedRow?.classList.contains('items-start')).toBe(true);
    expect(screen.getAllByTestId('vault-card').length).toBeLessThan(300);
    expect(renderedIndexes.size).toBe(screen.getAllByTestId('vault-card').length);
    expect(renderItem.mock.calls.length).toBeLessThan(300);
    expect(screen.getByTestId('virtualized-vault-grid').style.height).not.toBe('');
  });

  it('renders the destination rows immediately after a large scroll jump', async () => {
    render(
      <VirtualizedVaultGrid layoutKey="scroll-jump" sections={[{
        itemCount: 10_000,
        getItemKey: (index) => String(index),
        renderItem: (index) => <article data-item-index={index} data-testid="vault-card">项目 {index + 1}</article>,
      }]} />,
    );

    act(() => {
      scrollOffset = 10_000;
      window.dispatchEvent(new Event('scroll'));
    });

    await waitFor(() => {
      const renderedIndexes = screen.getAllByTestId('vault-card').map((card) => Number(card.dataset.itemIndex));
      expect(Math.min(...renderedIndexes)).toBeGreaterThan(50);
    });
  });
});
