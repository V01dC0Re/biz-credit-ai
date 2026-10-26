import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { Application, ApplicationStatus, Product } from '../types';
import MarkdownView from './MarkdownView';

interface ProductConfig {
  minAmount: number;
  maxAmount: number;
  stepAmount: number;
  defaultAmount: number;
  amountChips: { label: string; value: number }[];
  minTerm: number;
  maxTerm: number;
  stepTerm: number;
  defaultTerm: number;
  termChips: { label: string; value: number }[];
}

const getProductConfig = (product?: Product): ProductConfig => {
  const code = product?.code?.toLowerCase() || '';
  const name = product?.name?.toLowerCase() || '';

  if (code === 'overdraft' || name.includes('овердрафт')) {
    return {
      minAmount: 100000,
      maxAmount: 5000000,
      stepAmount: 50000,
      defaultAmount: 1000000,
      amountChips: [
        { label: '300 тыс ₽', value: 300000 },
        { label: '500 тыс ₽', value: 500000 },
        { label: '1.5 млн ₽', value: 1500000 },
        { label: '3 млн ₽', value: 3000000 },
        { label: '5 млн ₽', value: 5000000 },
      ],
      minTerm: 1,
      maxTerm: 12,
      stepTerm: 1,
      defaultTerm: 6,
      termChips: [
        { label: '1 мес', value: 1 },
        { label: '3 мес', value: 3 },
        { label: '6 мес', value: 6 },
        { label: '12 мес', value: 12 },
      ],
    };
  }

  if (code === 'investment_credit' || code === 'term_loan' || name.includes('инвестиционн')) {
    return {
      minAmount: 500000,
      maxAmount: 20000000,
      stepAmount: 250000,
      defaultAmount: 3000000,
      amountChips: [
        { label: '1.5 млн ₽', value: 1500000 },
        { label: '3 млн ₽', value: 3000000 },
        { label: '5 млн ₽', value: 5000000 },
        { label: '10 млн ₽', value: 10000000 },
        { label: '20 млн ₽', value: 20000000 },
      ],
      minTerm: 12,
      maxTerm: 60,
      stepTerm: 6,
      defaultTerm: 24,
      termChips: [
        { label: '12 мес', value: 12 },
        { label: '24 мес', value: 24 },
        { label: '36 мес', value: 36 },
        { label: '60 мес', value: 60 },
      ],
    };
  }

  // Default: Оборотный кредит (revolving_credit / working_capital)
  return {
    minAmount: 200000,
    maxAmount: 10000000,
    stepAmount: 100000,
    defaultAmount: 1500000,
    amountChips: [
      { label: '500 тыс ₽', value: 500000 },
      { label: '1.5 млн ₽', value: 1500000 },
      { label: '3 млн ₽', value: 3000000 },
      { label: '5 млн ₽', value: 5000000 },
      { label: '10 млн ₽', value: 10000000 },
    ],
    minTerm: 3,
    maxTerm: 36,
    stepTerm: 3,
    defaultTerm: 12,
    termChips: [
      { label: '6 мес', value: 6 },
      { label: '12 мес', value: 12 },
      { label: '24 мес', value: 24 },
      { label: '36 мес', value: 36 },
    ],
  };
};

interface Props {
  initialAppId?: number | null;
  initialParams?: { amount?: number; termMonths?: number } | null;
  onNavigateToDashboard: () => void;
}

export const ApplicationFlowScreen: React.FC<Props> = ({ initialAppId, initialParams, onNavigateToDashboard }) => {
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<number>(2); // default revolving credit
  const [amount, setAmount] = useState<number>(initialParams?.amount || 1500000);
  const [termMonths, setTermMonths] = useState<number>(initialParams?.termMonths || 12);
  const [purpose, setPurpose] = useState<string>('Пополнение оборотных средств для закупки товара');

  const [currentApp, setCurrentApp] = useState<Application | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Sign PEP Code
  const [signCode, setSignCode] = useState<string>('1234');

  // Document upload file
  const [docFile, setDocFile] = useState<File | null>(null);

  // AI Advisor Hint
  const [aiHint, setAiHint] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState<boolean>(false);

  // UC 1.3: автозаполнение реквизитов по ИНН (мок ФНС/ЕГРЮЛ)
  const [innInput, setInnInput] = useState<string>('');
  const [innLoading, setInnLoading] = useState<boolean>(false);
  const [innResult, setInnResult] = useState<{ name: string; okved: string; company_age_months: number } | null>(null);
  const [innError, setInnError] = useState<string | null>(null);

  const handleInnLookup = async () => {
    const inn = innInput.trim();
    if (inn.length < 10) {
      setInnError('Введите ИНН из 10 или 12 цифр');
      return;
    }
    setInnLoading(true);
    setInnError(null);
    setInnResult(null);
    try {
      const res = await api.lookupCompany(inn);
      setInnResult({ name: res.name, okved: res.okved, company_age_months: res.company_age_months });
    } catch (e) {
      setInnError(e instanceof Error ? e.message : 'Не удалось получить данные по ИНН');
    } finally {
      setInnLoading(false);
    }
  };

  useEffect(() => {
    loadProducts();
    if (initialAppId) {
      loadApplication(initialAppId);
    } else {
      setCurrentApp(null);
      if (initialParams?.amount) setAmount(initialParams.amount);
      if (initialParams?.termMonths) setTermMonths(initialParams.termMonths);
    }
  }, [initialAppId, initialParams]);

  // Timeline Transition title mapper
  const getStatusTransitionTitle = (fromStatus: string, toStatus: string, _comment?: string): string => {
    if (!fromStatus && toStatus === 'DRAFT') return 'Создание черновика заявки';
    if (toStatus === 'SCORING_IN_PROGRESS' || toStatus === 'DATA_ENRICHMENT') return 'Черновик ➜ Проверка скорингом';
    if (toStatus === 'COUNTER_OFFER') return 'Встречное предложение банка';
    if (toStatus === 'DOCS_REQUIRED') return 'Запрос подтверждающих документов';
    if (toStatus === 'DOCS_UPLOADED' || (toStatus === 'MANUAL_REVIEW' && fromStatus === 'DOCS_REQUIRED')) {
      return 'Документы загружены ➜ Передано риск-офицеру';
    }
    if (toStatus === 'MANUAL_REVIEW') return 'Передано на ручное рассмотрение';
    if (toStatus === 'APPROVED') {
      if (fromStatus === 'COUNTER_OFFER') return 'Встречное предложение принято клиентом';
      if (fromStatus === 'MANUAL_REVIEW' || fromStatus === 'DOCS_UPLOADED') return 'Одобрено кредитным офицером';
      return 'Заявка одобрена скорингом';
    }
    if (toStatus === 'PENDING_SIGNATURE') return 'Договор сформирован ➜ Ожидает подписания';
    if (toStatus === 'ISSUED') return 'Договор подписан ПЭП ➜ Деньги зачислены';
    if (toStatus === 'REJECTED') return 'Отказ в выдаче кредита';
    if (toStatus === 'CANCELLED_BY_CLIENT') return 'Заявка отменена клиентом';
    return `${fromStatus || 'Черновик'} ➜ ${toStatus}`;
  };

  // Timeline Status dot styling & icon
  const getStatusDotStyle = (toStatus: string) => {
    switch (toStatus) {
      case 'APPROVED':
      case 'ISSUED':
        return {
          bg: 'bg-emerald-500 text-white',
          icon: '✓',
        };
      case 'COUNTER_OFFER':
        return {
          bg: 'bg-amber-500 text-white',
          icon: '⚡',
        };
      case 'DOCS_REQUIRED':
      case 'DOCS_UPLOADED':
      case 'MANUAL_REVIEW':
        return {
          bg: 'bg-blue-500 text-white',
          icon: '📋',
        };
      case 'REJECTED':
      case 'CANCELLED_BY_CLIENT':
        return {
          bg: 'bg-red-500 text-white',
          icon: '✕',
        };
      case 'DRAFT':
      case 'DATA_ENRICHMENT':
      case 'SCORING_IN_PROGRESS':
      default:
        return {
          bg: 'bg-indigo-500 text-white animate-pulse',
          icon: '⏳',
        };
    }
  };

  // Format log timestamp
  const formatLogTime = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      const pad = (n: number) => n.toString().padStart(2, '0');
      const hours = pad(d.getHours());
      const minutes = pad(d.getMinutes());
      const seconds = pad(d.getSeconds());
      const day = pad(d.getDate());
      const month = pad(d.getMonth() + 1);
      const year = d.getFullYear();
      return `${hours}:${minutes}:${seconds}, ${day}.${month}.${year}`;
    } catch {
      return dateStr;
    }
  };

  const loadProducts = async () => {
    try {
      const res = await api.getProducts();
      setProducts(res.products);
      if (res.products.length > 0 && !selectedProductId) {
        setSelectedProductId(res.products[0].id);
      }
    } catch (err: any) {
      setError(err.message || 'Ошибка загрузки продуктов');
    }
  };

  const loadApplication = async (id: number) => {
    try {
      setLoading(true);
      setError(null);
      const app = await api.getApplication(id);
      setCurrentApp(app);
      setSelectedProductId(app.product_id);
      setAmount(app.amount);
      setTermMonths(app.term_months);
      setPurpose(app.purpose);
    } catch (err: any) {
      setError(err.message || 'Ошибка загрузки заявки');
    } finally {
      setLoading(false);
    }
  };

  const selectedProduct = products.find((p) => p.id === selectedProductId) || products[0];
  const currentProductConfig = useMemo(() => getProductConfig(selectedProduct), [selectedProduct]);

  const handleProductSelect = (p: Product) => {
    setSelectedProductId(p.id);
    const cfg = getProductConfig(p);
    setAmount((prev) => {
      if (prev < cfg.minAmount) return cfg.minAmount;
      if (prev > cfg.maxAmount) return cfg.maxAmount;
      return prev;
    });
    setTermMonths((prev) => {
      if (prev < cfg.minTerm) return cfg.minTerm;
      if (prev > cfg.maxTerm) return cfg.maxTerm;
      return prev;
    });
  };

  // Calculate estimated annuity monthly payment
  const calculateEstimatedPayment = (pAmount: number, pTerm: number, pRate: number) => {
    if (pTerm <= 0 || pAmount <= 0) return 0;
    const r = pRate / 1200;
    if (r === 0) return Math.ceil(pAmount / pTerm);
    return Math.ceil((pAmount * r) / (1 - Math.pow(1 + r, -pTerm)));
  };

  const estimatedPayment = selectedProduct
    ? calculateEstimatedPayment(amount, termMonths, selectedProduct.interest_rate)
    : 0;

  const formatMoney = (val: number) => {
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: 'RUB',
      maximumFractionDigits: 0,
    }).format(val);
  };

  // Submit flow: Create -> Submit
  const handleCreateAndSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setLoading(true);
      setError(null);
      setSuccessMsg(null);

      // Step 1: Create application
      const created = await api.createApplication({
        product_id: selectedProductId,
        purpose,
        amount,
        term_months: termMonths,
      });

      // Step 2: Submit to scoring
      const submitted = await api.submitApplication(created.id);
      setCurrentApp(submitted);
      setSuccessMsg(`Заявка №${submitted.id} успешно отправлена на скоринг!`);
    } catch (err: any) {
      setError(err.message || 'Ошибка подачи заявки');
    } finally {
      setLoading(false);
    }
  };

  // Counter-offer actions
  const handleCounterOffer = async (action: 'accept' | 'reject') => {
    if (!currentApp) return;
    try {
      setLoading(true);
      setError(null);
      const updated = await api.counterOffer(currentApp.id, action);
      setCurrentApp(updated);
      setSuccessMsg(
        action === 'accept'
          ? 'Встречные условия приняты! Переход к подписанию договора.'
          : 'Встречные условия отклонены. Заявка отменена.'
      );
    } catch (err: any) {
      setError(err.message || 'Ошибка обработки встречного предложения');
    } finally {
      setLoading(false);
    }
  };

  // Document upload
  const handleUploadDocument = async () => {
    if (!currentApp || !docFile) return;
    try {
      setLoading(true);
      setError(null);
      const updated = await api.uploadDocuments(currentApp.id, docFile);
      setCurrentApp(updated);
      setDocFile(null);
      setSuccessMsg('Документ успешно загружен! Заявка направлена на ручную проверку офицером.');
    } catch (err: any) {
      setError(err.message || 'Ошибка загрузки документа');
    } finally {
      setLoading(false);
    }
  };

  // Sign contract
  const handleSign = async () => {
    if (!currentApp) return;
    try {
      setLoading(true);
      setError(null);
      const updated = await api.signApplication(currentApp.id, signCode);
      setCurrentApp(updated);
      setSuccessMsg('Договор успешно подписан! Денежные средства зачислены на ваш расчетный счет.');
    } catch (err: any) {
      setError(err.message || 'Ошибка подписания');
    } finally {
      setLoading(false);
    }
  };

  // AI Advisor Advice
  const handleAskAI = async () => {
    try {
      setAiLoading(true);
      setAiHint(null);
      const res = await api.getContextualAdvice({
        client_id: 'current_user',
        revenue: 2000000,
        net_profit: 600000,
        requested_amount: amount,
        requested_term: termMonths,
        credit_product: selectedProduct.code,
        context: purpose,
      });
      setAiHint(res.advice);
    } catch (err: any) {
      setAiHint('AI-советник временно недоступен или сервер не отвечает.');
    } finally {
      setAiLoading(false);
    }
  };

  // Calculate step state for progress bar
  const getStepClass = (step: number, status?: ApplicationStatus) => {
    if (!status) return step === 1 ? 'step-active' : '';
    switch (status) {
      case 'DRAFT':
        return step === 1 ? 'step-active' : '';
      case 'DATA_ENRICHMENT':
      case 'SCORING_IN_PROGRESS':
        return step <= 1 ? 'step-done' : step === 2 ? 'step-active' : '';
      case 'DOCS_REQUIRED':
      case 'DOCS_UPLOADED':
      case 'MANUAL_REVIEW':
      case 'COUNTER_OFFER':
      case 'APPROVED':
        return step <= 2 ? 'step-done' : step === 3 ? 'step-active' : '';
      case 'PENDING_SIGNATURE':
        return step <= 3 ? 'step-done' : step === 4 ? 'step-active' : '';
      case 'ISSUED':
        return 'step-done';
      case 'REJECTED':
      case 'CANCELLED_BY_CLIENT':
        return step <= 2 ? 'step-done' : 'step-active';
      default:
        return '';
    }
  };

  return (
    <div style={{ maxWidth: '960px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.8rem', fontWeight: 800 }}>Кредитный конвейер онлайн</h1>
          <p style={{ color: 'var(--text-muted)' }}>Оформление заявки, мгновенная скоринг-оценка и выдача</p>
        </div>
        <button className="btn btn-secondary" onClick={onNavigateToDashboard}>
          ← В дашборд
        </button>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}
      {successMsg && <div className="alert alert-success">{successMsg}</div>}

      {/* Stepper */}
      <div className="card" style={{ padding: '1rem 1.5rem' }}>
        <div className="stepper">
          <div className={`step-item ${getStepClass(1, currentApp?.status)}`}>
            <div className="step-circle">1</div>
            <div>Параметры</div>
          </div>
          <div style={{ flex: 1, height: '2px', background: '#e2e8f0', margin: '0 0.5rem' }} />
          <div className={`step-item ${getStepClass(2, currentApp?.status)}`}>
            <div className="step-circle">2</div>
            <div>Скоринг</div>
          </div>
          <div style={{ flex: 1, height: '2px', background: '#e2e8f0', margin: '0 0.5rem' }} />
          <div className={`step-item ${getStepClass(3, currentApp?.status)}`}>
            <div className="step-circle">3</div>
            <div>Решение банка</div>
          </div>
          <div style={{ flex: 1, height: '2px', background: '#e2e8f0', margin: '0 0.5rem' }} />
          <div className={`step-item ${getStepClass(4, currentApp?.status)}`}>
            <div className="step-circle">4</div>
            <div>Подписание</div>
          </div>
          <div style={{ flex: 1, height: '2px', background: '#e2e8f0', margin: '0 0.5rem' }} />
          <div className={`step-item ${getStepClass(5, currentApp?.status)}`}>
            <div className="step-circle">5</div>
            <div>Выдача средств</div>
          </div>
        </div>
      </div>

      {/* State View 1: Application Form (when no current app or in DRAFT) */}
      {(!currentApp || currentApp.status === 'DRAFT') && (
        <form onSubmit={handleCreateAndSubmit}>
          {/* UC 1.3: автозаполнение реквизитов по ИНН */}
          <div className="card">
            <div className="card-title">0. Реквизиты компании (автозаполнение по ИНН)</div>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 240px' }}>
                <label className="form-label">ИНН организации</label>
                <input
                  className="form-input"
                  type="text"
                  inputMode="numeric"
                  placeholder="Например: 7701000001"
                  value={innInput}
                  onChange={(e) => setInnInput(e.target.value.replace(/\D/g, '').slice(0, 12))}
                />
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleInnLookup}
                disabled={innLoading}
                style={{ marginBottom: '0.1rem' }}
              >
                {innLoading ? 'Запрос в ФНС...' : 'Заполнить из ЕГРЮЛ'}
              </button>
            </div>
            {innError && (
              <div style={{ color: '#dc2626', fontSize: '0.85rem', marginTop: '0.5rem' }}>{innError}</div>
            )}
            {innResult && (
              <div style={{ marginTop: '0.75rem', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '6px', padding: '0.75rem', fontSize: '0.9rem' }}>
                <div><strong>{innResult.name}</strong></div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  ОКВЭД: {innResult.okved} • Стаж бизнеса: {innResult.company_age_months} мес.
                </div>
                <div style={{ color: '#059669', fontSize: '0.8rem', marginTop: '0.25rem' }}>
                  ✓ Данные получены из мока ФНС/ЕГРЮЛ
                </div>
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-title">1. Выбор кредитного продукта</div>
            <div className="grid-3" style={{ marginBottom: '1.5rem' }}>
              {products.map((p) => {
                const cfg = getProductConfig(p);
                const isSelected = selectedProductId === p.id;
                return (
                  <div
                    key={p.id}
                    onClick={() => handleProductSelect(p)}
                    style={{
                      border: isSelected ? '2px solid #EF3124' : '1px solid var(--border)',
                      borderRadius: 'var(--radius)',
                      padding: '1rem',
                      cursor: 'pointer',
                      background: isSelected ? '#fef2f2' : 'white',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: '1rem', color: '#0f172a' }}>{p.name}</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 800, color: isSelected ? '#EF3124' : 'var(--primary)', margin: '0.25rem 0' }}>
                      от {p.interest_rate}%
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      Лимит: до {formatMoney(cfg.maxAmount)}<br />
                      Срок: от {cfg.minTerm} до {cfg.maxTerm} мес.
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="card-title">2. Параметры кредита</div>

            <div className="grid-2">
              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                  <label className="form-label" style={{ margin: 0, fontWeight: 600 }}>
                    Сумма кредита:
                  </label>
                  <span style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--primary)' }}>
                    {formatMoney(amount)}
                  </span>
                </div>
                <input
                  type="range"
                  className="form-control"
                  style={{ padding: '0.2rem', cursor: 'pointer' }}
                  min={currentProductConfig.minAmount}
                  max={currentProductConfig.maxAmount}
                  step={currentProductConfig.stepAmount}
                  value={amount}
                  onChange={(e) => setAmount(Number(e.target.value))}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                  <span>{formatMoney(currentProductConfig.minAmount)}</span>
                  <span>Лимит до {formatMoney(currentProductConfig.maxAmount)}</span>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                  {currentProductConfig.amountChips.map((chip) => {
                    const isSelected = amount === chip.value;
                    return (
                      <button
                        key={chip.value}
                        type="button"
                        className={`btn btn-sm ${
                          isSelected
                            ? 'bg-[#EF3124] text-white border-[#EF3124]'
                            : 'btn-secondary'
                        }`}
                        style={{
                          padding: '0.3rem 0.65rem',
                          fontSize: '0.8rem',
                          fontWeight: isSelected ? 700 : 500,
                          backgroundColor: isSelected ? '#EF3124' : undefined,
                          borderColor: isSelected ? '#EF3124' : undefined,
                          color: isSelected ? '#ffffff' : undefined,
                        }}
                        onClick={() => setAmount(chip.value)}
                      >
                        {chip.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                  <label className="form-label" style={{ margin: 0, fontWeight: 600 }}>
                    Срок кредита:
                  </label>
                  <span style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--primary)' }}>
                    {termMonths} мес.
                  </span>
                </div>
                <input
                  type="range"
                  className="form-control"
                  style={{ padding: '0.2rem', cursor: 'pointer' }}
                  min={currentProductConfig.minTerm}
                  max={currentProductConfig.maxTerm}
                  step={currentProductConfig.stepTerm}
                  value={termMonths}
                  onChange={(e) => setTermMonths(Number(e.target.value))}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                  <span>{currentProductConfig.minTerm} мес.</span>
                  <span>до {currentProductConfig.maxTerm} мес.</span>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                  {currentProductConfig.termChips.map((chip) => {
                    const isSelected = termMonths === chip.value;
                    return (
                      <button
                        key={chip.value}
                        type="button"
                        className={`btn btn-sm ${
                          isSelected
                            ? 'bg-[#EF3124] text-white border-[#EF3124]'
                            : 'btn-secondary'
                        }`}
                        style={{
                          padding: '0.3rem 0.65rem',
                          fontSize: '0.8rem',
                          fontWeight: isSelected ? 700 : 500,
                          backgroundColor: isSelected ? '#EF3124' : undefined,
                          borderColor: isSelected ? '#EF3124' : undefined,
                          color: isSelected ? '#ffffff' : undefined,
                        }}
                        onClick={() => setTermMonths(chip.value)}
                      >
                        {chip.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Цель финансирования</label>
              <input
                type="text"
                className="form-control"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder="Например: Закупка партии товаров, расширение склада"
                required
              />
            </div>

            {/* Calculation tile */}
            <div
              style={{
                background: '#f8fafc',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                padding: '1rem 1.25rem',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '1.5rem',
              }}
            >
              <div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Ориентировочный ежемесячный платеж:</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--primary)' }}>
                  {formatMoney(estimatedPayment)} / мес
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Базовая ставка:</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{selectedProduct?.interest_rate}% годовых</div>
              </div>
            </div>

            {/* AI Advisor Callout */}
            <div style={{ background: '#fdf4ff', border: '1px solid #f0abfc', borderRadius: '8px', padding: '1rem', marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '1.2rem' }}>✨</span>
                  <span style={{ fontWeight: 700, color: '#86198f' }}>AI Финансовый советник</span>
                </div>
                <button
                  type="button"
                  className="btn btn-sm"
                  style={{ background: '#c026d3', color: 'white' }}
                  onClick={handleAskAI}
                  disabled={aiLoading}
                >
                  {aiLoading ? 'Анализ нейросетью...' : 'Получить подсказку AI'}
                </button>
              </div>

              {aiHint && (
                <div style={{ marginTop: '0.75rem', fontSize: '0.9rem', color: '#4a044e', lineHeight: 1.5 }}>
                  <MarkdownView content={aiHint} />
                </div>
              )}
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: '100%', padding: '0.9rem', fontSize: '1.05rem' }}
              disabled={loading}
            >
              {loading ? 'Отправка заявки...' : 'Отправить заявку на скоринг'}
            </button>
          </div>
        </form>
      )}

      {/* State View 2: Active application status & flow controls */}
      {currentApp && currentApp.status !== 'DRAFT' && (
        <div className="card">
          <div className="card-title">
            <span>Заявка №{currentApp.id}</span>
            <span className="badge badge-primary">{currentApp.status}</span>
          </div>

          <div className="grid-4" style={{ marginBottom: '1.5rem' }}>
            <div className="stat-tile">
              <div className="stat-label">Запрошено</div>
              <div className="stat-value">{formatMoney(currentApp.requested_amount || currentApp.amount)}</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{currentApp.requested_term_months || currentApp.term_months} мес.</div>
            </div>

            <div className="stat-tile">
              <div className="stat-label">Одобрено</div>
              <div className="stat-value" style={{ color: currentApp.approved_amount > 0 ? '#10b981' : 'inherit' }}>
                {currentApp.approved_amount > 0 ? formatMoney(currentApp.approved_amount) : '—'}
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                {currentApp.approved_term_months > 0 ? `${currentApp.approved_term_months} мес.` : '—'}
              </div>
            </div>

            <div className="stat-tile">
              <div className="stat-label">Платеж в месяц</div>
              <div className="stat-value">
                {currentApp.monthly_payment > 0 ? formatMoney(currentApp.monthly_payment) : '—'}
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Ставка: {currentApp.interest_rate > 0 ? `${currentApp.interest_rate}%` : '—'}
              </div>
            </div>

            <div className="stat-tile">
              <div className="stat-label">Скоринг балл</div>
              <div className="stat-value" style={{ color: '#2563eb' }}>
                {currentApp.score_value > 0 ? `${currentApp.score_value} / 1000` : '—'}
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                DSTI: {currentApp.dsti > 0 ? `${(currentApp.dsti * 100).toFixed(1)}%` : '—'}
              </div>
            </div>
          </div>

          {currentApp.ai_explanation && (
            <div className="alert alert-info" style={{ marginTop: '1rem' }}>
              <div>
                <strong style={{ display: 'block', marginBottom: '0.35rem' }}>🤖 Пояснение скоринга:</strong>
                <MarkdownView content={currentApp.ai_explanation} />
              </div>
            </div>
          )}

          {currentApp.officer_comment && (
            <div className="alert alert-warning">
              <div>
                <strong>Комментарий кредитного офицера:</strong> {currentApp.officer_comment}
              </div>
            </div>
          )}

          {/* Conditional Action Panels based on Status */}

          {/* Status: COUNTER_OFFER */}
          {currentApp.status === 'COUNTER_OFFER' && (
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', padding: '1.25rem', marginTop: '1rem' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#92400e', marginBottom: '0.5rem' }}>
                Банк сформировал встречное предложение!
              </h3>
              <p style={{ fontSize: '0.9rem', color: '#78350f', marginBottom: '1rem' }}>
                На основе анализа денежного потока предложен скорректированный лимит: <strong>{formatMoney(currentApp.approved_amount)}</strong> на <strong>{currentApp.approved_term_months} мес.</strong> с ежемесячным платежом <strong>{formatMoney(currentApp.monthly_payment)}</strong>.
              </p>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <button
                  className="btn btn-success"
                  onClick={() => handleCounterOffer('accept')}
                  disabled={loading}
                >
                  Принять встречные условия
                </button>
                <button
                  className="btn btn-danger"
                  onClick={() => handleCounterOffer('reject')}
                  disabled={loading}
                >
                  Отклонить
                </button>
              </div>
            </div>
          )}

          {/* Status: DOCS_REQUIRED */}
          {currentApp.status === 'DOCS_REQUIRED' && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '1.25rem', marginTop: '1rem' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#991b1b', marginBottom: '0.5rem' }}>
                Требуются подтверждающие документы
              </h3>
              <p style={{ fontSize: '0.9rem', color: '#7f1d1d', marginBottom: '1rem' }}>
                Срок деятельности компании менее 6 месяцев. Для продолжения рассмотрения загрузите бухгалтерскую отчетность или налоговую декларацию (PDF/PNG/JPG до 10 МБ).
              </p>
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                <input
                  type="file"
                  className="form-control"
                  style={{ maxWidth: '350px' }}
                  onChange={(e) => setDocFile(e.target.files ? e.target.files[0] : null)}
                />
                <button
                  className="btn btn-primary"
                  onClick={handleUploadDocument}
                  disabled={!docFile || loading}
                >
                  Загрузить документы
                </button>
              </div>
            </div>
          )}

          {/* Status: MANUAL_REVIEW or DOCS_UPLOADED */}
          {(currentApp.status === 'MANUAL_REVIEW' || currentApp.status === 'DOCS_UPLOADED') && (
            <div className="alert alert-warning" style={{ marginTop: '1rem' }}>
              <div>
                <strong>Заявка передана риск-офицеру:</strong> Документы получены. Андеррайтер банка изучает финансовую модель и примет персональное решение.
              </div>
            </div>
          )}

          {/* Status: APPROVED or PENDING_SIGNATURE */}
          {(currentApp.status === 'APPROVED' || currentApp.status === 'PENDING_SIGNATURE') && (
            <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: '8px', padding: '1.25rem', marginTop: '1rem' }}>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: '#065f46', marginBottom: '0.5rem' }}>
                Кредит одобрен! Договор готов к подписанию
              </h3>
              <p style={{ fontSize: '0.9rem', color: '#047857', marginBottom: '1rem' }}>
                Для мгновенного зачисления кредитных средств введите код из СМС (простая электронная подпись).
              </p>

              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', maxWidth: '450px' }}>
                <input
                  type="text"
                  className="form-control"
                  placeholder="Код из СМС (1234)"
                  value={signCode}
                  onChange={(e) => setSignCode(e.target.value)}
                  style={{ textAlign: 'center', fontSize: '1.1rem', letterSpacing: '2px', fontWeight: 700 }}
                />
                <button
                  className="btn btn-success"
                  style={{ whiteSpace: 'nowrap' }}
                  onClick={handleSign}
                  disabled={loading || !signCode}
                >
                  {loading ? 'Подписание...' : 'Подписать онлайн'}
                </button>
              </div>
              <div style={{ fontSize: '0.8rem', color: '#047857', marginTop: '0.4rem' }}>
                Демонстрационный код ПЭП: <strong>1234</strong>
              </div>
            </div>
          )}

          {/* Status: ISSUED */}
          {currentApp.status === 'ISSUED' && (
            <div style={{ background: '#f0fdf4', border: '2px solid #22c55e', borderRadius: 'var(--radius)', padding: '2rem', textAlign: 'center', marginTop: '1.5rem' }}>
              <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>🎉</div>
              <h2 style={{ fontSize: '1.6rem', fontWeight: 800, color: '#15803d', marginBottom: '0.5rem' }}>
                Кредит успешно выдан!
              </h2>
              <p style={{ fontSize: '1.05rem', color: '#166534', maxWidth: '600px', margin: '0 auto 1.5rem' }}>
                Сумма <strong>{formatMoney(currentApp.approved_amount)}</strong> поступила на расчетный счет компании. График платежей доступен в выписке.
              </p>
              <button className="btn btn-primary" onClick={onNavigateToDashboard}>
                Перейти в личный кабинет
              </button>
            </div>
          )}

          {/* Status: REJECTED */}
          {currentApp.status === 'REJECTED' && (
            <div className="alert alert-danger" style={{ marginTop: '1rem' }}>
              <div>
                <strong>Кредит не может быть одобрен:</strong> {currentApp.rejection_reason || 'Недостаточная платежеспособность или наличие критических стоп-факторов.'}
              </div>
            </div>
          )}

          {/* Reset / New Application button */}
          <div style={{ marginTop: '1.5rem', textAlign: 'right' }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setCurrentApp(null)}
            >
              + Создать другую заявку
            </button>
          </div>
        </div>
      )}

      {/* Interactive Audit Timeline / Vertical Stepper */}
      {currentApp && currentApp.status_logs && currentApp.status_logs.length > 0 && (
        <div className="card" style={{ marginTop: '1.5rem' }}>
          <div className="card-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <span style={{ fontSize: '1.25rem' }}>📜</span>
              <span style={{ fontSize: '1.2rem', fontWeight: 800 }}>История рассмотрения и аудит заявки</span>
            </div>
            <span className="badge badge-secondary" style={{ fontSize: '0.8rem', padding: '0.3rem 0.65rem' }}>
              Переходов: {currentApp.status_logs.length}
            </span>
          </div>

          <div className="timeline-stepper">
            {currentApp.status_logs.map((log, index) => {
              const dot = getStatusDotStyle(log.to_status);
              return (
                <div key={log.id || index} className="timeline-step">
                  <div className={`timeline-dot ${dot.bg}`}>
                    {dot.icon}
                  </div>
                  <div className="timeline-content">
                    <div className="timeline-header">
                      <span className="timeline-title">
                        {getStatusTransitionTitle(log.from_status, log.to_status, log.comment)}
                      </span>
                      <span className="timeline-time">
                        {formatLogTime(log.created_at)}
                      </span>
                    </div>

                    {log.from_status && (
                      <div className="timeline-transition">
                        Переход: <span>{log.from_status}</span> ➜ <strong>{log.to_status}</strong>
                      </div>
                    )}

                    {log.comment && (
                      <div className="timeline-comment">
                        <MarkdownView content={log.comment} />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
