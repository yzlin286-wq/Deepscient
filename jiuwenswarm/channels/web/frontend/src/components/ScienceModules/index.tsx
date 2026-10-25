import { useTranslation } from 'react-i18next';
import {
  Archive,
  BookOpen,
  ChartColumn,
  FlaskConical,
  PenLine,
  RefreshCw,
  Send,
  type LucideIcon,
} from 'lucide-react';
import {
  moduleExpertCount,
  pickLocalizedText,
  type ScienceModule,
} from './presentation';
import './ScienceModules.css';

const MODULE_ICONS: Record<string, LucideIcon> = {
  'book-open': BookOpen,
  'flask-conical': FlaskConical,
  'chart-column': ChartColumn,
  'pen-line': PenLine,
  send: Send,
  archive: Archive,
};

const SKELETON_KEYS = ['skeleton-1', 'skeleton-2', 'skeleton-3', 'skeleton-4', 'skeleton-5', 'skeleton-6'];

export interface ScienceModulesProps {
  modules: ScienceModule[];
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onEnter: (moduleId: string) => void;
}

export function ScienceModules({
  modules,
  loading = false,
  error = null,
  onRetry,
  onEnter,
}: ScienceModulesProps) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;

  return (
    <section className="science-modules" data-testid="science-modules" aria-label={t('scienceModules.title')}>
      <header className="science-modules__header">
        <h3 className="science-modules__title" data-testid="science-modules-title">
          {t('scienceModules.title')}
        </h3>
        <p className="science-modules__subtitle" data-testid="science-modules-subtitle">
          {t('scienceModules.subtitle')}
        </p>
      </header>

      {loading && modules.length === 0 ? (
        <div className="science-modules__grid" data-testid="science-modules-loading" role="status" aria-live="polite">
          {SKELETON_KEYS.map((key) => (
            <div className="science-module-card science-module-card--skeleton" key={key} data-testid="science-modules-skeleton">
              <span className="science-modules__skeleton-line science-modules__skeleton-line--title" />
              <span className="science-modules__skeleton-line" />
              <span className="science-modules__skeleton-line science-modules__skeleton-line--short" />
              {t('scienceModules.loading')}
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="science-modules__error" data-testid="science-modules-error" role="alert">
          <p className="science-modules__error-text">{error}</p>
          {onRetry && (
            <button
              type="button"
              className="science-modules__retry"
              data-testid="science-modules-retry"
              onClick={onRetry}
            >
              <RefreshCw size={14} aria-hidden="true" />
              {t('scienceModules.retry')}
            </button>
          )}
        </div>
      ) : (
        <div className="science-modules__grid" data-testid="science-modules-grid">
          {modules.map((module) => {
            const Icon = MODULE_ICONS[module.icon] ?? BookOpen;
            const expertCount = moduleExpertCount(module);
            const title = pickLocalizedText(module.title, language, module.id);
            return (
              <button
                type="button"
                key={module.id}
                className="science-module-card"
                data-testid={`science-modules-card-${module.id}`}
                onClick={() => onEnter(module.id)}
              >
                <span className="science-module-card__icon" aria-hidden="true">
                  <Icon size={18} />
                </span>
                <span className="science-module-card__title" data-testid={`science-modules-card-title-${module.id}`}>
                  {title}
                </span>
                <span className="science-module-card__description" data-testid={`science-modules-card-description-${module.id}`}>
                  {pickLocalizedText(module.description, language)}
                </span>
                {module.tags.length > 0 && (
                  <span className="science-module-card__tags" data-testid={`science-modules-card-tags-${module.id}`}>
                    {module.tags.map((tag) => (
                      <span className="science-module-card__tag" key={`${module.id}-${tag}`}>{tag}</span>
                    ))}
                  </span>
                )}
                <span
                  className="science-module-card__meta"
                  data-testid={`science-modules-card-meta-${module.id}`}
                  title={t('scienceModules.teamLabel')}
                >
                  {t('scienceModules.expertCount', { count: expertCount })}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
