import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { LandingRoot } from './features/landing/LandingRoot';
import type { LandingLocale } from './features/landing/landing-i18n';
import './styles/app.css';

export function mountLanding(locale: LandingLocale) {
  const root = document.getElementById('root');
  const landing = (
    <StrictMode>
      <LandingRoot locale={locale} />
    </StrictMode>
  );

  if (!root) {
    throw new Error('Root element #root was not found');
  }

  if (root.dataset.lumenPrerendered === 'true') {
    hydrateRoot(root, landing);
  } else {
    createRoot(root).render(landing);
  }
}
