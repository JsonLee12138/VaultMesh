import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { Toaster } from './components/ui/sonner';
import './styles/app.css';

export function bootstrap(container: HTMLElement): void {
  createRoot(container).render(
    <StrictMode>
      <App />
      <Toaster position="top-center" />
    </StrictMode>,
  );
}
