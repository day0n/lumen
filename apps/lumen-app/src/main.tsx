import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { router } from './router';
import './styles/app.css';

if (__LUMEN_SENTRY_DSN__) {
  const initSentry = () => {
    void import('@sentry/react').then((Sentry) => {
      Sentry.init({
        dsn: __LUMEN_SENTRY_DSN__,
        environment: __LUMEN_SENTRY_ENVIRONMENT__,
        tracesSampleRate: __LUMEN_SENTRY_TRACES_SAMPLE_RATE__,
      });
    });
  };

  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(initSentry, { timeout: 3000 });
  } else {
    globalThis.setTimeout(initSentry, 1000);
  }
}

const root = document.getElementById('root');

if (!root) {
  throw new Error('Root element #root was not found');
}

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
