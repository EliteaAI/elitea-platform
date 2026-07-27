import { useTranslation } from 'react-i18next';

export function Banner() {
  const { t } = useTranslation();
  return (
    <button type="button" title={t('banner.dismiss')}>
      {t('banner.cta')}
    </button>
  );
}
