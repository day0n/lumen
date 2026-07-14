import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ShareEntry } from './features/share/ShareEntry';
import { resolveClientLocale } from './i18n/provider';
import { AppProviders } from './providers/app-providers';
import './styles/app.css';

const root = document.getElementById('root');
const initialLocale = resolveClientLocale(
  window.location.pathname === '/zh' || window.location.pathname.startsWith('/zh/')
    ? 'zh'
    : undefined,
);

if (!root) {
  throw new Error('Root element #root was not found');
}

createRoot(root).render(
  <StrictMode>
    <AppProviders enableApiAuthBridge={false} initialLocale={initialLocale}>
      <ShareEntry />
    </AppProviders>
  </StrictMode>,
);
