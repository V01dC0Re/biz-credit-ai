import React, { useEffect, useState } from 'react';
import { api } from '../api';
import type { Application } from '../types';
import MarkdownView from './MarkdownView';

export const OfficerScreen: React.FC = () => {
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Active filter tab
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');

  // Modal / Prompt state for Counter Offer (Quick)
  const [counterApp, setCounterApp] = useState<Application | null>(null);
  const [counterAmount, setCounterAmount] = useState<number>(1000000);
  const [counterTerm, setCounterTerm] = useState<number>(12);
  const [officerComment, setOfficerComment] = useState<string>('Снижение лимита по результатам оценки рисков');

  // Dossier Modal State
  const [dossierApp, setDossierApp] = useState<Application | null>(null);
  const [dossierAmount, setDossierAmount] = useState<number>(0);
  const [dossierTerm, setDossierTerm] = useState<number>(0);
  const [dossierComment, setDossierComment] = useState<string>('');

  // UC 2.2: AI-саммари по заявке для риск-офицера
  const [aiSummary, setAiSummary] = useState<string>('');
  const [summaryLoading, setSummaryLoading] = useState<boolean>(false);

  const generateSummary = async (app: Application) => {
    setSummaryLoading(true);
    setAiSummary('');
    try {
      const res = await api.officerSummary({
        application_id: app.id,
        company_name: app.company?.name || `Компания #${app.company_id}`,
        inn: app.company?.inn || '',
        okved: app.company?.okved || '',
        company_age_months: app.company?.company_age_months || 0,
        monthly_revenue: app.company?.monthly_revenue || app.company?.revenue || 0,
        monthly_net_profit: app.company?.monthly_net_profit || 0,
        requested_amount: app.requested_amount || app.amount,
        requested_term_months: app.requested_term_months || app.term_months,
        score_value: app.score_value || 0,
        dsti: app.dsti || 0,
        bki_delinquency_days: app.company?.bki_delinquency_days || 0,
        bki_active_loans_monthly_payment: app.company?.bki_active_loans_monthly_payment || 0,
        has_bankruptcy: app.company?.has_bankruptcy || false,
        status: app.status,
      });
      setAiSummary(res.summary);
    } catch (e) {
      setAiSummary('Не удалось сформировать выжимку. Проверьте доступность AI-сервиса.');
    } finally {
      setSummaryLoading(false);
    }
  };

  const fetchApplications = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.getOfficerApplications();
      setApplications(res.applications || []);
    } catch (err: any) {
      setError(err.message || 'Ошибка загрузки очереди заявок');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchApplications();
  }, []);

  const openDossier = (app: Application) => {
    setDossierApp(app);
    const initialAmount = app.approved_amount > 0 ? app.approved_amount : (app.requested_amount || app.amount);
    const initialTerm = app.approved_term_months > 0 ? app.approved_term_months : (app.requested_term_months || app.term_months);
    setDossierAmount(initialAmount);
    setDossierTerm(initialTerm);
    setDossierComment(app.officer_comment || '');
    setAiSummary('');
  };

  const handleDecision = async (
    id: number,
    payload: {
      decision: string;
      comment?: string;
      approved_amount?: number;
      approved_term_months?: number;
      counter_amount?: number;
      counter_term_months?: number;
    }
  ) => {
    try {
      setLoading(true);
      setError(null);
      await api.officerDecision(id, payload);
      setCounterApp(null);
      setDossierApp(null);
      setActionSuccess(`Решение "${payload.decision}" по заявке №${id} успешно зафиксировано!`);
      await fetchApplications();
    } catch (err: any) {
      setError(err.message || 'Ошибка принятия решения');
    } finally {
      setLoading(false);
    }
  };

  const formatMoney = (val: number) => {
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: 'RUB',
      maximumFractionDigits: 0,
    }).format(val || 0);
  };

  const getStatusBadge = (status: string) => {
    const map: Record<string, { label: string; className: string }> = {
      DRAFT: { label: 'Черновик', className: 'badge-draft' },
      DATA_ENRICHMENT: { label: 'Обогащение данных', className: 'badge-scoring' },
      SCORING_IN_PROGRESS: { label: 'Скоринг', className: 'badge-scoring' },
      APPROVED: { label: 'Одобрено', className: 'badge-approved' },
      COUNTER_OFFER: { label: 'Встречное предл.', className: 'badge-counter' },
      DOCS_REQUIRED: { label: 'Ждет документы', className: 'badge-docs' },
      DOCS_UPLOADED: { label: 'Документы загружены', className: 'badge-manual' },
      MANUAL_REVIEW: { label: 'На ручной проверке', className: 'badge-manual' },
      PENDING_SIGNATURE: { label: 'На подписании', className: 'badge-signature' },
      ISSUED: { label: 'Выдан', className: 'badge-issued' },
      REJECTED: { label: 'Отказано', className: 'badge-rejected' },
      CANCELLED_BY_CLIENT: { label: 'Отменен', className: 'badge-draft' },
    };
    const s = map[status] || { label: status, className: 'badge-draft' };
    return <span className={`badge ${s.className}`}>{s.label}</span>;
  };

  const filteredApps = applications.filter((a) => {
    if (filter === 'pending') {
      return a.status === 'MANUAL_REVIEW' || a.status === 'DOCS_UPLOADED' || a.status === 'DOCS_REQUIRED';
    }
    if (filter === 'approved') {
      return a.status === 'APPROVED' || a.status === 'PENDING_SIGNATURE' || a.status === 'ISSUED';
    }
    if (filter === 'rejected') {
      return a.status === 'REJECTED' || a.status === 'CANCELLED_BY_CLIENT';
    }
    return true;
  });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.8rem', fontWeight: 800 }}>Кабинет кредитного риск-офицера</h1>
          <p style={{ color: 'var(--text-muted)' }}>Очередь андеррайтинга, ручной скоринг и детальные кредитные досье</p>
        </div>
        <button className="btn btn-secondary" onClick={fetchApplications} disabled={loading}>
          {loading ? 'Обновление...' : '🔄 Обновить очередь'}
        </button>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}
      {actionSuccess && <div className="alert alert-success">{actionSuccess}</div>}

      {/* Filter Tabs */}
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem' }}>
        <button
          className={`btn btn-sm ${filter === 'all' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setFilter('all')}
        >
          Все заявки ({applications.length})
        </button>
        <button
          className={`btn btn-sm ${filter === 'pending' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setFilter('pending')}
        >
          На проверке ({applications.filter((a) => a.status === 'MANUAL_REVIEW' || a.status === 'DOCS_UPLOADED' || a.status === 'DOCS_REQUIRED').length})
        </button>
        <button
          className={`btn btn-sm ${filter === 'approved' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setFilter('approved')}
        >
          Одобренные ({applications.filter((a) => a.status === 'APPROVED' || a.status === 'ISSUED').length})
        </button>
        <button
          className={`btn btn-sm ${filter === 'rejected' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setFilter('rejected')}
        >
          Отказы ({applications.filter((a) => a.status === 'REJECTED').length})
        </button>
      </div>

      {/* Quick Counter Offer Box */}
      {counterApp && (
        <div className="card" style={{ border: '2px solid #f59e0b', background: '#fffbeb', marginBottom: '1.5rem' }}>
          <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: '#92400e', marginBottom: '0.75rem' }}>
            Быстрое встречное предложение для заявки №{counterApp.id}
          </h3>
          <p style={{ fontSize: '0.9rem', color: '#78350f', marginBottom: '1rem' }}>
            Клиент запросил: <strong>{formatMoney(counterApp.amount)}</strong> на <strong>{counterApp.term_months} мес.</strong>
          </p>

          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">Скорректированная сумма (₽)</label>
              <input
                type="number"
                className="form-control"
                value={counterAmount}
                step={50000}
                onChange={(e) => setCounterAmount(Number(e.target.value))}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Скорректированный срок (мес.)</label>
              <input
                type="number"
                className="form-control"
                value={counterTerm}
                min={1}
                max={60}
                onChange={(e) => setCounterTerm(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Комментарий риск-офицера</label>
            <input
              type="text"
              className="form-control"
              value={officerComment}
              onChange={(e) => setOfficerComment(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button
              className="btn btn-primary"
              onClick={() =>
                handleDecision(counterApp.id, {
                  decision: 'COUNTER_OFFER',
                  comment: officerComment || 'Встречное предложение кредитного офицера',
                  counter_amount: counterAmount,
                  counter_term_months: counterTerm,
                  approved_amount: counterAmount,
                  approved_term_months: counterTerm,
                })
              }
              disabled={loading}
            >
              Отправить встречное предложение
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => setCounterApp(null)}
            >
              Отмена
            </button>
          </div>
        </div>
      )}

      {/* Applications Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Компания</th>
                <th>Запрошено</th>
                <th>Одобрено</th>
                <th>Платеж</th>
                <th>Скоринг</th>
                <th>Статус</th>
                <th style={{ textAlign: 'right' }}>Действия андеррайтера</th>
              </tr>
            </thead>
            <tbody>
              {filteredApps.length > 0 ? (
                filteredApps.map((app) => (
                  <tr key={app.id}>
                    <td><strong>#{app.id}</strong></td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{app.company?.name || `Компания #${app.company_id}`}</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        ИНН: {app.company?.inn || '—'}
                      </div>
                    </td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{formatMoney(app.amount)}</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{app.term_months} мес.</div>
                    </td>
                    <td>
                      {app.approved_amount > 0 ? (
                        <>
                          <div style={{ fontWeight: 600, color: '#059669' }}>{formatMoney(app.approved_amount)}</div>
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{app.approved_term_months} мес. @ {app.interest_rate}%</div>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      {app.monthly_payment > 0 ? formatMoney(app.monthly_payment) : '—'}
                    </td>
                    <td>
                      {app.score_value > 0 ? (
                        <div>
                          <div style={{ fontWeight: 700, color: '#2563eb' }}>{app.score_value}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            DSTI: {(app.dsti * 100).toFixed(1)}%
                          </div>
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>{getStatusBadge(app.status)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '0.4rem', justifyContent: 'flex-end', alignItems: 'center' }}>
                        <button
                          className="btn btn-secondary btn-sm"
                          title="Открыть полное кредитное досье заявки"
                          onClick={() => openDossier(app)}
                          style={{ fontWeight: 600 }}
                        >
                          📋 Детали / Досье
                        </button>

                        {app.status !== 'APPROVED' && app.status !== 'ISSUED' && (
                          <button
                            className="btn btn-success btn-sm"
                            title="Одобрить заявку"
                            onClick={() => {
                              const reqAmount = app.requested_amount || app.amount;
                              const reqTerm = app.requested_term_months || app.term_months;
                              handleDecision(app.id, {
                                decision: 'APPROVE',
                                comment: 'Одобрено офицером',
                                approved_amount: reqAmount,
                                approved_term_months: reqTerm,
                              });
                            }}
                            disabled={loading}
                          >
                            ✓ Одобрить
                          </button>
                        )}

                        {app.status !== 'ISSUED' && app.status !== 'REJECTED' && (
                          <button
                            className="btn btn-secondary btn-sm"
                            title="Встречное предложение"
                            onClick={() => {
                              setCounterApp(app);
                              setCounterAmount(Math.round(app.amount * 0.7));
                              setCounterTerm(app.term_months);
                            }}
                            disabled={loading}
                          >
                            Встречные
                          </button>
                        )}

                        {app.status !== 'REJECTED' && app.status !== 'ISSUED' && (
                          <button
                            className="btn btn-danger btn-sm"
                            title="Отклонить"
                            onClick={() =>
                              handleDecision(app.id, {
                                decision: 'REJECT',
                                comment: 'Отклонено кредитным офицером',
                              })
                            }
                            disabled={loading}
                          >
                            ✕ Отказ
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                    В выбранной категории нет заявок
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Full Dossier Modal Drawer */}
      {dossierApp && (
        <div className="modal-overlay" onClick={() => setDossierApp(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '900px' }}>
            <div className="modal-header">
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <h2 style={{ fontSize: '1.35rem', fontWeight: 800 }}>
                    Кредитное досье заявки #{dossierApp.id}
                  </h2>
                  {getStatusBadge(dossierApp.status)}
                </div>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                  Подана: {new Date(dossierApp.created_at).toLocaleString('ru-RU')} | Запрошено: {formatMoney(dossierApp.requested_amount || dossierApp.amount)} на {dossierApp.requested_term_months || dossierApp.term_months} мес.
                </p>
              </div>
              <button
                onClick={() => setDossierApp(null)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontSize: '1.5rem',
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  lineHeight: 1,
                }}
                title="Закрыть"
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              {/* БЛОК 1: Профиль компании */}
              <div className="dossier-section">
                <div className="dossier-section-title">
                  🏢 <span>Профиль компании</span>
                </div>
                <div className="dossier-grid">
                  <div>
                    <div className="dossier-label">Наименование организации</div>
                    <div className="dossier-value" style={{ fontSize: '1.05rem', color: '#1e3a8a' }}>
                      {dossierApp.company?.name || `Компания #${dossierApp.company_id}`}
                    </div>
                  </div>
                  <div>
                    <div className="dossier-label">ИНН организации</div>
                    <div className="dossier-value">{dossierApp.company?.inn || '7701000001'}</div>
                  </div>
                  <div>
                    <div className="dossier-label">Отрасль (ОКВЭД)</div>
                    <div className="dossier-value">{dossierApp.company?.okved || '46.90 — Торговля оптовая'}</div>
                  </div>
                  <div>
                    <div className="dossier-label">Ежемесячная выручка</div>
                    <div className="dossier-value" style={{ color: '#059669' }}>
                      {formatMoney(dossierApp.company?.monthly_revenue || dossierApp.company?.revenue || 0)}
                    </div>
                  </div>
                  <div>
                    <div className="dossier-label">Чистая прибыль (мес.)</div>
                    <div className="dossier-value" style={{ color: '#059669' }}>
                      {formatMoney(dossierApp.company?.monthly_net_profit || 0)}
                    </div>
                  </div>
                  <div>
                    <div className="dossier-label">Срок работы (возраст бизнеса)</div>
                    <div className="dossier-value">
                      {dossierApp.company?.company_age_months || 0} мес. ({Math.floor((dossierApp.company?.company_age_months || 0) / 12)} г. {(dossierApp.company?.company_age_months || 0) % 12} мес.)
                    </div>
                  </div>
                  <div>
                    <div className="dossier-label">Текущий остаток на р/с</div>
                    <div className="dossier-value">
                      {formatMoney(dossierApp.company?.balance || 0)}
                    </div>
                  </div>
                  <div>
                    <div className="dossier-label">Цель кредитования</div>
                    <div className="dossier-value">{dossierApp.purpose || 'Пополнение оборотных средств'}</div>
                  </div>
                </div>
              </div>

              {/* БЛОК 2: Риск-аналитика */}
              <div className="dossier-section">
                <div className="dossier-section-title">
                  📊 <span>Риск-аналитика и скоринг</span>
                </div>
                <div className="dossier-grid" style={{ marginBottom: '1rem' }}>
                  <div>
                    <div className="dossier-label">Скоринговый балл</div>
                    <div className="dossier-value" style={{ fontSize: '1.25rem', color: (dossierApp.score_value >= 600 ? '#059669' : dossierApp.score_value >= 400 ? '#d97706' : '#dc2626') }}>
                      {dossierApp.score_value > 0 ? `${dossierApp.score_value} / 1000` : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="dossier-label">Показатель долговой нагрузки (DSTI)</div>
                    <div className="dossier-value" style={{ fontSize: '1.1rem', color: (dossierApp.dsti <= 0.5 ? '#059669' : '#dc2626') }}>
                      {dossierApp.dsti > 0 ? `${(dossierApp.dsti * 100).toFixed(1)}%` : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="dossier-label">Статус банкротства (Федресурс)</div>
                    <div className="dossier-value">
                      {dossierApp.company?.has_bankruptcy ? (
                        <span style={{ color: '#dc2626', fontWeight: 700 }}>⚠️ Выявлены факты банкротства</span>
                      ) : (
                        <span style={{ color: '#059669', fontWeight: 600 }}>✅ Отсутствуют</span>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="dossier-label">Просрочки по кредитам (БКИ)</div>
                    <div className="dossier-value">
                      {(dossierApp.company?.bki_delinquency_days || 0) > 0 ? (
                        <span style={{ color: '#dc2626', fontWeight: 700 }}>{dossierApp.company?.bki_delinquency_days} дн. просрочки</span>
                      ) : (
                        <span style={{ color: '#059669', fontWeight: 600 }}>✅ 0 дн. (чистая история)</span>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="dossier-label">Активные кредитные платежи (БКИ)</div>
                    <div className="dossier-value">
                      {formatMoney(dossierApp.company?.bki_active_loans_monthly_payment || 0)} / мес.
                    </div>
                  </div>
                  <div>
                    <div className="dossier-label">Движок андеррайтинга</div>
                    <div className="dossier-value" style={{ textTransform: 'uppercase', fontSize: '0.85rem' }}>
                      {dossierApp.scoring_source || 'AI ML-Engine'}
                    </div>
                  </div>
                </div>

                <div style={{ background: 'white', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.9rem' }}>
                  <div className="dossier-label" style={{ marginBottom: '0.35rem' }}>
                    🤖 Заключение AI-анализа / Пояснение скоринга:
                  </div>
                  <div style={{ fontSize: '0.9rem', color: 'var(--text-main)', lineHeight: 1.5 }}>
                    <MarkdownView content={dossierApp.ai_explanation || dossierApp.rejection_reason || 'Автоматическая оценка рисков проведена на базе финансовых показателей компании, кредитной истории БКИ и норматива долговой нагрузки DSTI.'} />
                  </div>
                </div>

                {/* UC 2.2: ИИ-саммари для риск-офицера */}
                <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '6px', padding: '0.9rem', marginTop: '0.75rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <div className="dossier-label" style={{ margin: 0 }}>
                      ✨ ИИ-саммари для офицера
                    </div>
                    <button
                      className="btn btn-secondary"
                      style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}
                      onClick={() => generateSummary(dossierApp)}
                      disabled={summaryLoading}
                    >
                      {summaryLoading ? 'Анализ...' : 'Сгенерировать выжимку'}
                    </button>
                  </div>
                  {aiSummary ? (
                    <div style={{ fontSize: '0.9rem', color: 'var(--text-main)', lineHeight: 1.5 }}>
                      <MarkdownView content={aiSummary} />
                    </div>
                  ) : (
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      Нажмите кнопку, чтобы получить краткую выжимку по заявке: уровень риска, ключевые факторы и рекомендацию.
                    </div>
                  )}
                </div>
              </div>

              {/* БЛОК 3: Прикрепленные документы */}
              <div className="dossier-section">
                <div className="dossier-section-title">
                  📁 <span>Прикрепленные документы ({dossierApp.documents ? dossierApp.documents.length : 0})</span>
                </div>
                {dossierApp.documents && dossierApp.documents.length > 0 ? (
                  <div>
                    {dossierApp.documents.map((doc) => {
                      const token = localStorage.getItem('token') || '';
                      const downloadUrl = `/api/applications/${dossierApp.id}/documents/${doc.id}${token ? `?token=${encodeURIComponent(token)}` : ''}`;
                      return (
                        <div key={doc.id} className="doc-item">
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <span style={{ fontSize: '1.4rem' }}>📄</span>
                            <div>
                              <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{doc.filename}</div>
                              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                                Загружен: {new Date(doc.created_at).toLocaleString('ru-RU')}
                              </div>
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <span className="badge badge-approved" style={{ fontSize: '0.75rem' }}>
                              ✓ Проверен
                            </span>
                            <a
                              href={downloadUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="btn btn-secondary btn-sm"
                            >
                              Просмотр / Скачать ⬇️
                            </a>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ padding: '1rem', background: 'white', borderRadius: '6px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                    Документы не загружались (запрос документов не требовался или ожидается загрузка клиентом)
                  </div>
                )}
              </div>

              {/* БЛОК 4: Блок принятия решений */}
              <div className="dossier-section" style={{ border: '2px solid #3b82f6', background: '#eff6ff' }}>
                <div className="dossier-section-title" style={{ color: '#1e40af' }}>
                  ⚖️ <span>Блок принятия решений кредитного офицера</span>
                </div>

                <div className="grid-2" style={{ marginBottom: '1rem' }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Одобряемая сумма (₽)</label>
                    <input
                      type="number"
                      className="form-control"
                      value={dossierAmount}
                      step={50000}
                      onChange={(e) => setDossierAmount(Number(e.target.value))}
                    />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Одобряемый срок (мес.)</label>
                    <input
                      type="number"
                      className="form-control"
                      value={dossierTerm}
                      min={1}
                      max={60}
                      onChange={(e) => setDossierTerm(Number(e.target.value))}
                    />
                  </div>
                </div>

                <div className="form-group" style={{ marginBottom: '1rem' }}>
                  <label className="form-label">Комментарий риск-офицера</label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="Введите комментарий или причину решения..."
                    value={dossierComment}
                    onChange={(e) => setDossierComment(e.target.value)}
                  />
                </div>

                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <button
                    className="btn btn-success"
                    onClick={() => {
                      handleDecision(dossierApp.id, {
                        decision: 'APPROVE',
                        comment: dossierComment || 'Одобрено кредитным офицером',
                        approved_amount: dossierAmount || dossierApp.requested_amount || dossierApp.amount,
                        approved_term_months: dossierTerm || dossierApp.requested_term_months || dossierApp.term_months,
                      });
                    }}
                    disabled={loading}
                  >
                    ✓ Одобрить ({formatMoney(dossierAmount || dossierApp.amount)})
                  </button>

                  <button
                    className="btn btn-primary"
                    style={{ background: '#d97706', borderColor: '#b45309' }}
                    onClick={() => {
                      handleDecision(dossierApp.id, {
                        decision: 'COUNTER_OFFER',
                        comment: dossierComment || 'Встречное предложение кредитного офицера',
                        counter_amount: dossierAmount,
                        counter_term_months: dossierTerm,
                        approved_amount: dossierAmount,
                        approved_term_months: dossierTerm,
                      });
                    }}
                    disabled={loading}
                  >
                    🤝 Встречное предложение
                  </button>

                  <button
                    className="btn btn-danger"
                    onClick={() => {
                      handleDecision(dossierApp.id, {
                        decision: 'REJECT',
                        comment: dossierComment || 'Отклонено кредитным офицером',
                      });
                    }}
                    disabled={loading}
                  >
                    ✕ Отказ
                  </button>
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setDossierApp(null)}>
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
