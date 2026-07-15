import type { ReactNode } from 'react';
import { useI18n } from '../../i18n/provider';
import { localePath } from '../../i18n/routing';
import { ClerkAuthBoundary } from './ClerkAuthBoundary';

export function ClerkAuthShell({ children }: { children: ReactNode }) {
  const { locale, t, ta } = useI18n();
  return (
    <ClerkAuthBoundary
      backPath={localePath('/', locale)}
      copy={{
        backHome: t('auth.troubleshoot.backHome'),
        loading: t('auth.loading'),
        networkHint: t('auth.troubleshoot.networkHint'),
        retry: t('auth.troubleshoot.retry'),
        timeoutTitle: t('auth.troubleshoot.title'),
        tips: ta('auth.troubleshoot.tips'),
      }}
    >
      {children}
    </ClerkAuthBoundary>
  );
}
