import type { Application, DashboardData, Product, User } from './types';

const BASE_URL = '/api';

export function getToken(): string | null {
  return localStorage.getItem('token');
}

export function setAuth(token: string, user: User) {
  localStorage.setItem('token', token);
  localStorage.setItem('user', JSON.stringify(user));
}

export function clearAuth() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
}

export function getCurrentUser(): User | null {
  const raw = localStorage.getItem('user');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };

  if (options.body instanceof FormData) {
    delete headers['Content-Type'];
  } else if (!headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    clearAuth();
    window.dispatchEvent(new Event('auth-expired'));
  }

  if (!response.ok) {
    let errorMsg = `Ошибка сервера (${response.status})`;
    try {
      const errJson = await response.json();
      if (errJson.error) {
        errorMsg = errJson.error;
      }
    } catch {
      // ignore
    }
    throw new Error(errorMsg);
  }

  return response.json();
}

export const api = {
  // Auth
  login: async (email: string, password = '123'): Promise<{ token: string; user: User }> => {
    return request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  },

  // Client
  getDashboard: async (): Promise<DashboardData> => {
    return request('/dashboard');
  },

  getProducts: async (): Promise<{ products: Product[] }> => {
    return request('/products');
  },

  // UC 1.3: автозаполнение реквизитов по ИНН (мок ФНС/ЕГРЮЛ).
  lookupCompany: async (inn: string): Promise<{
    inn: string;
    name: string;
    okved: string;
    registration_date: string;
    company_age_months: number;
    status: string;
    source: string;
  }> => {
    return request(`/company/lookup?inn=${encodeURIComponent(inn)}`);
  },

  createApplication: async (data: {
    product_id: number;
    purpose: string;
    amount: number;
    term_months: number;
  }): Promise<Application> => {
    return request('/applications', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  getApplication: async (id: number): Promise<Application> => {
    return request(`/applications/${id}`);
  },

  getApplications: async (): Promise<{ applications: Application[] }> => {
    return request('/applications');
  },

  submitApplication: async (id: number): Promise<Application> => {
    return request(`/applications/${id}/submit`, {
      method: 'POST',
    });
  },

  counterOffer: async (id: number, action: 'accept' | 'reject'): Promise<Application> => {
    return request(`/applications/${id}/counter-offer`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    });
  },

  uploadDocuments: async (id: number, file: File): Promise<Application> => {
    const formData = new FormData();
    formData.append('file', file);
    return request(`/applications/${id}/documents`, {
      method: 'POST',
      body: formData,
    });
  },

  signApplication: async (id: number, code = '1234'): Promise<Application> => {
    return request(`/applications/${id}/sign`, {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
  },

  // Officer
  getOfficerApplications: async (): Promise<{ applications: Application[] }> => {
    return request('/officer/applications');
  },

  officerDecision: async (
    id: number,
    data: {
      decision: string;
      counter_amount?: number;
      counter_term_months?: number;
      approved_amount?: number;
      approved_term_months?: number;
      amount?: number;
      term_months?: number;
      comment?: string;
    }
  ): Promise<Application> => {
    return request(`/officer/applications/${id}/decision`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // AI Advisor
  compareProducts: async (productA: string, productB: string): Promise<{ advice: string }> => {
    return request('/v1/advice/compare', {
      method: 'POST',
      body: JSON.stringify({ product_a: productA, product_b: productB }),
    });
  },

  // UC 2.2: краткая выжимка по заявке для риск-офицера.
  officerSummary: async (data: {
    application_id: number;
    company_name: string;
    inn: string;
    okved: string;
    company_age_months: number;
    monthly_revenue: number;
    monthly_net_profit: number;
    requested_amount: number;
    requested_term_months: number;
    score_value: number;
    dsti: number;
    bki_delinquency_days: number;
    bki_active_loans_monthly_payment: number;
    has_bankruptcy: boolean;
    status: string;
  }): Promise<{ summary: string }> => {
    return request('/v1/advice/officer-summary', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  getContextualAdvice: async (data: {
    client_id: string;
    revenue: number;
    net_profit: number;
    requested_amount: number;
    requested_term: number;
    payment_type?: string;
    credit_product?: string;
    context?: string;
  }): Promise<{ advice: string }> => {
    return request('/v1/advice/contextual', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
};
