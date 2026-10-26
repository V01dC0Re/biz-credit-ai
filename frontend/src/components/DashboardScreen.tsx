import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { DashboardData, NewsArticle } from '../types';
import MarkdownView from './MarkdownView';

interface Props {
  onNavigateToApplication: (appId?: number, params?: { amount?: number; termMonths?: number }) => void;
  onNavigateToCalculator?: () => void;
}

export const DashboardScreen: React.FC<Props> = ({ onNavigateToApplication, onNavigateToCalculator }) => {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Tab filtering state
  const [selectedTab, setSelectedTab] = useState<string>('recommended');
  const [visibleCount, setVisibleCount] = useState<number>(6);

  // Modal reader state for article details
  const [selectedNews, setSelectedNews] = useState<NewsArticle | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedNews(null);
    };
    if (selectedNews) {
      window.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [selectedNews]);

  const fetchDashboard = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.getDashboard();
      setData(res);
    } catch (err: any) {
      setError(err.message || 'Ошибка загрузки дашборда');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboard();
  }, []);

  const formatMoney = (amount: number) => {
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: 'RUB',
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const getStatusBadge = (status: string) => {
    const map: Record<string, { label: string; className: string }> = {
      DRAFT: { label: 'Черновик', className: 'badge-draft' },
      DATA_ENRICHMENT: { label: 'Обогащение данных', className: 'badge-scoring' },
      SCORING_IN_PROGRESS: { label: 'Скоринг в процессе', className: 'badge-scoring' },
      APPROVED: { label: 'Одобрено', className: 'badge-approved' },
      COUNTER_OFFER: { label: 'Встречное предложение', className: 'badge-counter' },
      DOCS_REQUIRED: { label: 'Требуются документы', className: 'badge-docs' },
      DOCS_UPLOADED: { label: 'Документы загружены', className: 'badge-manual' },
      MANUAL_REVIEW: { label: 'Ручное рассмотрение', className: 'badge-manual' },
      PENDING_SIGNATURE: { label: 'Ожидает подписания', className: 'badge-signature' },
      ISSUED: { label: 'Выдан (Деньги на счете)', className: 'badge-issued' },
      REJECTED: { label: 'Отказано', className: 'badge-rejected' },
      CANCELLED_BY_CLIENT: { label: 'Отменено клиентом', className: 'badge-draft' },
    };
    const s = map[status] || { label: status, className: 'badge-draft' };
    return <span className={`badge ${s.className}`}>{s.label}</span>;
  };

  // Determine company segment for personalization
  const primaryTarget = useMemo(() => {
    if (data?.primary_target) return data.primary_target;
    if (!data?.company_info) return 'all';
    const age = data.company_info.company_age_months || 0;
    if (age > 0 && age < 6) return 'startup';
    const okved = data.company_info.okved || '';
    if (okved.startsWith('62') || okved.startsWith('63')) return 'it';
    if (okved.startsWith('47')) return 'retail';
    if (okved.startsWith('25') || okved.startsWith('10')) return 'production';
    return 'all';
  }, [data]);

  const segmentLabel = useMemo(() => {
    switch (primaryTarget) {
      case 'it':
        return 'IT и высокие технологии';
      case 'retail':
        return 'Розничная торговля и e-commerce';
      case 'startup':
        return 'Стартапы и начинающий бизнес (< 6 мес.)';
      case 'production':
        return 'Производство и логистика';
      default:
        return 'Малый и средний бизнес';
    }
  }, [primaryTarget]);

  // Tab definitions
  const tabs = [
    { id: 'recommended', label: '⭐ Рекомендовано вам' },
    { id: 'all', label: 'Все статьи' },
    { id: 'Господдержка', label: 'Господдержка' },
    { id: 'Финансы', label: 'Финансы' },
    { id: 'Налоги', label: 'Налоги' },
    { id: 'Альфа-Сервисы', label: 'Альфа-Сервисы' },
  ];

  // Filtered news items
  const filteredNews = useMemo(() => {
    const list = data?.news_feed || [];
    if (selectedTab === 'recommended') {
      return list.filter(
        (item) => item.target_audience === primaryTarget || item.target_audience === 'all'
      );
    }
    if (selectedTab === 'all') {
      return list;
    }
    return list.filter((item) => item.category === selectedTab);
  }, [data?.news_feed, selectedTab, primaryTarget]);

  const visibleNews = useMemo(() => {
    return filteredNews.slice(0, visibleCount);
  }, [filteredNews, visibleCount]);

  const handleTabChange = (tabId: string) => {
    setSelectedTab(tabId);
    setVisibleCount(6); // reset pagination when tab changes
  };

  const getCategoryBadgeClass = (category: string) => {
    switch (category) {
      case 'Альфа-Сервисы':
        return 'badge-category-alfa';
      case 'Господдержка':
        return 'badge-category-support';
      case 'IT-бизнес':
        return 'badge-category-it';
      case 'Ритейл':
      case 'Маркетплейсы':
        return 'badge-category-retail';
      case 'Налоги':
        return 'badge-category-taxes';
      case 'Финансы':
        return 'badge-category-finance';
      case 'ВЭД':
        return 'badge-category-ved';
      default:
        return 'badge-category-finance';
    }
  };

  const getCategoryBadgeStyle = (category: string) => {
    switch (category) {
      case 'Альфа-Сервисы': return 'bg-red-50 text-red-600 border-red-200';
      case 'Господдержка': return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'IT-бизнес': return 'bg-indigo-50 text-indigo-700 border-indigo-200';
      case 'Ритейл':
      case 'Маркетплейсы': return 'bg-purple-50 text-purple-700 border-purple-200';
      case 'Налоги': return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'Финансы': return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'ВЭД': return 'bg-cyan-50 text-cyan-700 border-cyan-200';
      default: return 'bg-gray-50 text-gray-700 border-gray-200';
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '4rem 0', color: 'var(--text-muted)' }}>
        <div style={{ fontSize: '1.2rem', fontWeight: 600 }}>Загрузка дашборда компании...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="card">
        <div className="alert alert-danger">{error || 'Не удалось загрузить данные'}</div>
        <button className="btn btn-primary" onClick={fetchDashboard}>Повторить попытку</button>
      </div>
    );
  }

  const { company_info, active_application } = data;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Top Banner: Company Profile */}
      <div className="card" style={{ background: 'linear-gradient(135deg, #233142 0%, #455D7A 100%)', color: 'white', marginBottom: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ fontSize: '0.85rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Личный кабинет клиента
            </div>
            <h1 style={{ fontSize: '1.8rem', fontWeight: 700, margin: '0.25rem 0' }}>{company_info.name}</h1>
            <div style={{ display: 'flex', gap: '1.5rem', color: '#cbd5e1', fontSize: '0.9rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
              <span>ИНН: <strong>{company_info.inn}</strong></span>
              <span>ОКВЭД: <strong>{company_info.okved}</strong></span>
              <span>Стаж бизнеса: <strong>{company_info.company_age_months || 0} мес.</strong></span>
              <span>Сегмент: <strong style={{ color: '#38bdf8' }}>{segmentLabel}</strong></span>
            </div>
          </div>

          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '0.85rem', color: '#94a3b8' }}>Расчетный счет (Баланс)</div>
            <div style={{ fontSize: '2rem', fontWeight: 800, color: '#38bdf8' }}>
              {formatMoney(company_info.balance || 0)}
            </div>
          </div>
        </div>

        <div className="grid-3" style={{ marginTop: '1.5rem', borderTop: '1px solid #334155', paddingTop: '1.25rem' }}>
          <div>
            <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Выручка в месяц</div>
            <div style={{ fontSize: '1.15rem', fontWeight: 600 }}>{formatMoney(company_info.monthly_revenue || 0)}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Чистая прибыль в месяц</div>
            <div style={{ fontSize: '1.15rem', fontWeight: 600, color: '#4ade80' }}>
              {formatMoney(company_info.monthly_net_profit || 0)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Платежи по кредитам (БКИ)</div>
            <div style={{ fontSize: '1.15rem', fontWeight: 600, color: '#f87171' }}>
              {formatMoney(company_info.bki_active_loans_monthly_payment || 0)} / мес
            </div>
          </div>
        </div>
      </div>

      {/* Active Application Card */}
      <div
          className="card dashboard-application-card"
          style={{ marginBottom: 0 }}
      >
        <div className="card-title">
          <span>Активная кредитная заявка</span>
          {active_application && getStatusBadge(active_application.status)}
        </div>

        {active_application ? (
          <div>
            <div className="grid-4" style={{ marginBottom: '1rem' }}>
              <div className="stat-tile">
                <div className="stat-label">Сумма кредита</div>
                <div className="stat-value">{formatMoney(active_application.approved_amount || active_application.amount)}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Запрошено: {formatMoney(active_application.requested_amount || active_application.amount)}</div>
              </div>
              <div className="stat-tile">
                <div className="stat-label">Срок</div>
                <div className="stat-value">{active_application.approved_term_months || active_application.term_months} мес.</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Ставка: {active_application.interest_rate > 0 ? `${active_application.interest_rate}%` : '—'}</div>
              </div>
              <div className="stat-tile">
                <div className="stat-label">Ежемесячный платеж</div>
                <div className="stat-value" style={{ color: active_application.monthly_payment > 0 ? '#233142' : 'inherit' }}>
                  {active_application.monthly_payment > 0 ? formatMoney(active_application.monthly_payment) : '—'}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Аннуитет</div>
              </div>
              <div className="stat-tile">
                <div className="stat-label">Скоринг балл</div>
                <div className="stat-value" style={{ color: '#2563eb' }}>
                  {active_application.score_value > 0 ? `${active_application.score_value} / 1000` : '—'}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  DSTI: {active_application.dsti > 0 ? `${(active_application.dsti * 100).toFixed(1)}%` : '—'}
                </div>
              </div>
            </div>

            <div style={{ fontSize: '0.9rem', marginBottom: '1rem', color: '#455D7A' }}>
              <strong>Цель кредита:</strong> {active_application.purpose || 'Не указана'}
            </div>

            {active_application.ai_explanation && (
              <div style={{ background: '#F7F9FB', border: '1px solid #CDDDE9', padding: '0.85rem', borderRadius: '8px', marginBottom: '1.25rem', fontSize: '0.9rem' }}>
                <strong style={{ display: 'block', marginBottom: '0.35rem', color: '#1e40af' }}>🤖 Пояснение скоринга:</strong>
                <MarkdownView content={active_application.ai_explanation} />
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <button
                className="btn btn-primary"
                onClick={() => onNavigateToApplication(active_application.id)}
              >
                Перейти к конвейеру заявки
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => onNavigateToApplication()}
              >
                + Новая заявка
              </button>
            </div>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '2rem 1rem' }}>
            <p style={{ color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
              У вашей компании сейчас нет активных кредитных заявок.
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
              <button
                className="btn btn-primary"
                onClick={() => onNavigateToApplication()}
              >
                Подать заявку на кредит онлайн
              </button>
              <button
                className="btn btn-secondary"
                onClick={onNavigateToCalculator}
              >
                🧮 Оценить шансы в калькуляторе
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Compact Banner: Quick link to Calculator */}
      <div 
        onClick={onNavigateToCalculator}
        style={{
          background: 'linear-gradient(135deg, #FFE6DD 0%, #F7F9FB 100%)',
          border: '1px solid #CDDDE9',
          borderRadius: 'var(--radius)',
          padding: '1.1rem 1.5rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          transition: 'all 0.15s ease',
          boxShadow: '0 2px 8px -2px rgba(0, 0, 0, 0.05)',
          marginBottom: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ fontSize: '1.75rem', width: '42px', height: '42px', borderRadius: '10px', background: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            🧮
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '1.05rem', color: '#233142' }}>
              Оценить шансы в кредитном калькуляторе
            </div>
            <div style={{ fontSize: '0.85rem', color: '#475569', marginTop: '0.15rem' }}>
              Рассчитайте прогнозный ежемесячный платеж и показатель долговой нагрузки (DSTI) до подачи заявки
            </div>
          </div>
        </div>
        <button 
          type="button"
          className="btn btn-primary"
          style={{ whiteSpace: 'nowrap', padding: '0.55rem 1.25rem', fontWeight: 600, fontSize: '0.9rem' }}
          onClick={(e) => { e.stopPropagation(); onNavigateToCalculator?.(); }}
        >
          Рассчитать шансы →
        </button>
      </div>

      {/* Full-width Personalized News & Financial Insights Section */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
          <div>
            <h2 style={{ fontSize: '1.35rem', fontWeight: 800, color: '#233142', margin: 0 }}>
              Финансовый пульс и база знаний для бизнеса
            </h2>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
              32 статьи, экспертные гайды и госпрограммы • Адаптировано под {company_info.name} ({segmentLabel})
            </div>
          </div>
          <span className="badge badge-primary" style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}>
            Статей в выборке: {filteredNews.length}
          </span>
        </div>

        {/* Interactive Filter Tabs */}
        <div className="news-tabs-container">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`news-tab-btn ${selectedTab === tab.id ? 'active' : ''}`}
              onClick={() => handleTabChange(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* 3-Column Responsive News Grid */}
        {visibleNews.length > 0 ? (
          <div className="news-grid">
            {visibleNews.map((item) => (
              <div
                key={item.id}
                className="news-card"
                onClick={() => setSelectedNews(item)}
              >
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                    <span className={getCategoryBadgeClass(item.category)}>
                      {item.category}
                    </span>
                    <span className="news-tag-pill">{item.tag}</span>
                  </div>

                  <h3
                    className="news-card-title"
                    title={item.title}
                  >
                    {item.title}
                  </h3>

                  <p className="news-card-summary">
                    {item.summary || item.content}
                  </p>
                </div>

                <div className="news-card-footer">
                  <span>⏱ {item.read_time || '3 мин'}</span>
                  <span>📅 {item.date || 'Недавно'}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted)' }}>
            В выбранной категории пока нет публикаций.
          </div>
        )}

        {/* Show More Button (if more than visibleCount articles) */}
        {filteredNews.length > visibleCount && (
          <div style={{ textAlign: 'center', marginTop: '1.75rem' }}>
            <button
              className="btn btn-secondary"
              style={{ padding: '0.65rem 2rem', fontWeight: 600, fontSize: '0.9rem' }}
              onClick={() => setVisibleCount((prev) => prev + 6)}
            >
              Показать еще ({filteredNews.length - visibleCount} осталось) ↓
            </button>
          </div>
        )}
      </div>

      {/* Article Detail Modal */}
      {selectedNews && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto animate-fadeIn"
          onClick={() => setSelectedNews(null)}
        >
          <div 
            className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl p-6 md:p-8 transform transition-all my-8"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Шапка: Категория, тег и кнопка закрытия */}
            <div className="flex items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`px-3 py-1 text-xs font-semibold rounded-full border ${getCategoryBadgeStyle(selectedNews.category)}`}>
                  {selectedNews.category}
                </span>
                {selectedNews.tag && (
                  <span className="px-3 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-600">
                    #{selectedNews.tag}
                  </span>
                )}
              </div>
              <button
                onClick={() => setSelectedNews(null)}
                className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors text-lg"
                aria-label="Закрыть"
              >
                ✕
              </button>
            </div>

            {/* Заголовок */}
            <h3 className="text-xl md:text-2xl font-bold text-gray-900 mb-3 leading-snug">
              {selectedNews.title}
            </h3>

            {/* Мета-информация */}
            <div className="flex items-center gap-4 text-xs text-gray-400 mb-6 pb-4 border-b border-gray-100">
              <span>⏱ {selectedNews.read_time}</span>
              <span>📅 {selectedNews.date}</span>
              {selectedNews.target_audience && (
                <span>🎯 Для кого: {selectedNews.target_audience}</span>
              )}
            </div>

            {/* Текст новости */}
            <div className="text-gray-700 text-sm md:text-base leading-relaxed mb-8">
              <p>{selectedNews.summary}</p>
              <div className="mt-4 p-4 bg-red-50/60 border border-red-100 rounded-xl text-xs text-red-900 flex items-center gap-2">
                <span>💡</span>
                <span>Материал подготовлен экспертами и финансовыми аналитиками Альфа-Банка для поддержки малого бизнеса.</span>
              </div>
            </div>

            {/* Футер */}
            <div className="flex justify-end">
              <button
                onClick={() => setSelectedNews(null)}
                className="px-6 py-2.5 bg-[#EF3124] hover:bg-[#d6271a] text-white text-sm font-medium rounded-xl shadow-sm transition-all"
              >
                Понятно
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
