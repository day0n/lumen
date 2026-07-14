import { LandingPage } from './LandingPage';
import { LandingI18nProvider, type LandingLocale } from './landing-i18n';

export function LandingRoot({ locale }: { locale: LandingLocale }) {
  return (
    <LandingI18nProvider initialLocale={locale}>
      <LandingPage />
    </LandingI18nProvider>
  );
}
