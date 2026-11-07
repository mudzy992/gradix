export type MeUser = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  roles: string[];
  permissions: string[];
  companyId: string | null;
  company: { id: string; name: string; slug: string } | null;
  mustChangePassword: boolean;
  locale: 'bs' | 'en';
};

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type Envelope<T> = { success: true; data: T; meta?: unknown };
export type EnvelopeError = { success: false; error: { code: string; message: string; details?: Record<string, unknown> } };
