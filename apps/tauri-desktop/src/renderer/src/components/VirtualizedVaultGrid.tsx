import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';

const GRID_GAP = 16;
const ESTIMATED_ROW_HEIGHT = 240;
const OVERSCAN_ROWS = 3;
const OVERSCAN_VIEWPORTS = 2;

interface ViewportRange {
  start: number;
  end: number;
}

interface RowHeightState {
  columnCount: number;
  layoutKey: string;
  heights: Map<number, number>;
}

export interface VirtualizedVaultGridSection {
  itemCount: number;
  getItemKey: (index: number) => string;
  renderItem: (index: number) => ReactNode;
}

export function vaultGridColumnCount(viewportWidth: number): number {
  if (viewportWidth >= 1_120) return 3;
  if (viewportWidth >= 768) return 2;
  return 1;
}

function useVaultGridColumnCount(): number {
  const [columnCount, setColumnCount] = useState(() => vaultGridColumnCount(window.innerWidth));

  useEffect(() => {
    let animationFrame: number | null = null;
    const updateColumnCount = (): void => {
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = null;
        setColumnCount(vaultGridColumnCount(window.innerWidth));
      });
    };

    window.addEventListener('resize', updateColumnCount, { passive: true });
    return () => {
      window.removeEventListener('resize', updateColumnCount);
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
    };
  }, []);

  return columnCount;
}

function VirtualizedVaultRow({ children, columnCount, index, start, onHeightChange }: { children: ReactNode; columnCount: number; index: number; start: number; onHeightChange: (index: number, height: number) => void }) {
  const rowRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;

    const measure = (): void => {
      const height = row.offsetHeight;
      if (height > 0) onHeightChange(index, height);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [index, onHeightChange]);

  return (
    <div ref={rowRef} className="absolute top-0 left-0 w-full" data-index={index} style={{ transform: `translateY(${start}px)` }}>
      <div className="grid items-start gap-4" data-column-count={columnCount} style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}>{children}</div>
    </div>
  );
}

export function VirtualizedVaultGrid({ layoutKey, sections }: { layoutKey: string; sections: VirtualizedVaultGridSection[] }) {
  const gridRef = useRef<HTMLDivElement>(null);
  const columnCount = useVaultGridColumnCount();
  const itemCount = sections.reduce((total, section) => total + section.itemCount, 0);
  const rowCount = Math.ceil(itemCount / columnCount);
  const [rowHeightState, setRowHeightState] = useState<RowHeightState>(() => ({ columnCount, layoutKey, heights: new Map() }));
  const [viewport, setViewport] = useState<ViewportRange>(() => ({ start: 0, end: window.innerHeight }));
  const rowHeights = rowHeightState.columnCount === columnCount && rowHeightState.layoutKey === layoutKey ? rowHeightState.heights : new Map<number, number>();

  const updateViewport = useCallback((): void => {
    const grid = gridRef.current;
    if (!grid) return;
    const gridTop = grid.getBoundingClientRect().top;
    const nextViewport = {
      start: Math.max(0, -gridTop),
      end: Math.max(0, window.innerHeight - gridTop),
    };
    setViewport((current) => current.start === nextViewport.start && current.end === nextViewport.end ? current : nextViewport);
  }, []);

  useLayoutEffect(updateViewport);

  useEffect(() => {
    window.addEventListener('scroll', updateViewport, { passive: true });
    window.addEventListener('resize', updateViewport, { passive: true });
    return () => {
      window.removeEventListener('scroll', updateViewport);
      window.removeEventListener('resize', updateViewport);
    };
  }, [updateViewport]);

  const handleRowHeightChange = useCallback((index: number, height: number): void => {
    setRowHeightState((current) => {
      const sameLayout = current.columnCount === columnCount && current.layoutKey === layoutKey;
      const heights = sameLayout ? current.heights : new Map<number, number>();
      if (heights.get(index) === height) return sameLayout ? current : { columnCount, layoutKey, heights };
      const nextHeights = new Map(heights);
      nextHeights.set(index, height);
      return { columnCount, layoutKey, heights: nextHeights };
    });
  }, [columnCount, layoutKey]);

  const rowGeometry = useMemo(() => {
    const measuredRows = [...rowHeights.entries()].sort(([left], [right]) => left - right);
    const cumulativeAdjustments: number[] = [];
    let adjustment = 0;
    for (const [, height] of measuredRows) {
      adjustment += height - ESTIMATED_ROW_HEIGHT;
      cumulativeAdjustments.push(adjustment);
    }
    const adjustmentBefore = (index: number): number => {
      let low = 0;
      let high = measuredRows.length;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if ((measuredRows[middle]?.[0] ?? Number.POSITIVE_INFINITY) < index) low = middle + 1;
        else high = middle;
      }
      return low === 0 ? 0 : cumulativeAdjustments[low - 1] ?? 0;
    };
    const start = (index: number): number => index * (ESTIMATED_ROW_HEIGHT + GRID_GAP) + adjustmentBefore(index);
    const end = (index: number): number => start(index) + (rowHeights.get(index) ?? ESTIMATED_ROW_HEIGHT);
    const totalHeight = rowCount === 0
      ? 0
      : rowCount * (ESTIMATED_ROW_HEIGHT + GRID_GAP) - GRID_GAP + (cumulativeAdjustments.at(-1) ?? 0);
    return { end, start, totalHeight };
  }, [rowCount, rowHeights]);

  const virtualMeasurements = useMemo(() => {
    if (rowCount === 0) return [];
    const overscan = Math.max(
      OVERSCAN_ROWS * (ESTIMATED_ROW_HEIGHT + GRID_GAP),
      (viewport.end - viewport.start) * OVERSCAN_VIEWPORTS,
    );
    const visibleStart = Math.max(0, viewport.start - overscan);
    const visibleEnd = viewport.end + overscan;
    let low = 0;
    let high = rowCount - 1;
    let firstRow = rowCount - 1;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      if (rowGeometry.end(middle) >= visibleStart) { firstRow = middle; high = middle - 1; }
      else low = middle + 1;
    }
    low = firstRow;
    high = rowCount - 1;
    let lastRow = firstRow;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      if (rowGeometry.start(middle) <= visibleEnd) { lastRow = middle; low = middle + 1; }
      else high = middle - 1;
    }
    return Array.from({ length: lastRow - firstRow + 1 }, (_, offset) => {
      const index = firstRow + offset;
      return { index, start: rowGeometry.start(index) };
    });
  }, [rowCount, rowGeometry, viewport]);

  const renderGridItem = (globalIndex: number): ReactNode => {
    let sectionStart = 0;
    for (const section of sections) {
      const sectionEnd = sectionStart + section.itemCount;
      if (globalIndex < sectionEnd) {
        const itemIndex = globalIndex - sectionStart;
        return <Fragment key={section.getItemKey(itemIndex)}>{section.renderItem(itemIndex)}</Fragment>;
      }
      sectionStart = sectionEnd;
    }
    return null;
  };

  return (
    <div ref={gridRef} className="relative w-full" data-testid="virtualized-vault-grid" style={{ height: `${rowGeometry.totalHeight}px` }}>
      {virtualMeasurements.map((measurement) => (
        <VirtualizedVaultRow
          key={measurement.index}
          columnCount={columnCount}
          index={measurement.index}
          start={measurement.start}
          onHeightChange={handleRowHeightChange}
        >
          {Array.from(
            { length: Math.min(columnCount, itemCount - measurement.index * columnCount) },
            (_, columnIndex) => renderGridItem(measurement.index * columnCount + columnIndex),
          )}
        </VirtualizedVaultRow>
      ))}
    </div>
  );
}
