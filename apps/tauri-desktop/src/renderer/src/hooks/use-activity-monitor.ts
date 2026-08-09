import { useEffect } from 'react';

const REPORT_INTERVAL_MS = 15_000;

export function useActivityMonitor(): void {
  useEffect(() => {
    let lastReport = 0;
    const report = (): void => {
      const now = Date.now();
      if (now - lastReport < REPORT_INTERVAL_MS) return;
      lastReport = now;
      window.vaultMesh.activity();
    };

    window.addEventListener('keydown', report);
    window.addEventListener('pointerdown', report);
    window.addEventListener('input', report);
    return () => {
      window.removeEventListener('keydown', report);
      window.removeEventListener('pointerdown', report);
      window.removeEventListener('input', report);
    };
  }, []);
}
