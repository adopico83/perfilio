'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type EmailModalItem = {
  remitente: string | null;
  asunto: string | null;
  fechaIso: string | null;
  noLeido: boolean;
  cuerpo?: string | null;
  motivoUrgencia?: string[] | null;
};

type EmailModalContextValue = {
  emailOpen: boolean;
  urgentesOpen: boolean;
  emailActual: EmailModalItem | null;
  urgentes: EmailModalItem[];
  abrirEmail: (email: EmailModalItem) => void;
  cerrarEmail: () => void;
  abrirUrgentes: (emails: EmailModalItem[]) => void;
  cerrarUrgentes: () => void;
};

const EmailModalContext = createContext<EmailModalContextValue | null>(null);

export function EmailModalProvider({ children }: { children: ReactNode }) {
  const [emailOpen, setEmailOpen] = useState(false);
  const [urgentesOpen, setUrgentesOpen] = useState(false);
  const [emailActual, setEmailActual] = useState<EmailModalItem | null>(null);
  const [urgentes, setUrgentes] = useState<EmailModalItem[]>([]);

  const abrirEmail = useCallback((email: EmailModalItem) => {
    setUrgentesOpen(false);
    setEmailActual(email);
    setEmailOpen(true);
  }, []);

  const cerrarEmail = useCallback(() => {
    setEmailOpen(false);
  }, []);

  const abrirUrgentes = useCallback((emails: EmailModalItem[]) => {
    setUrgentes(Array.isArray(emails) ? emails : []);
    setUrgentesOpen(true);
  }, []);

  const cerrarUrgentes = useCallback(() => {
    setUrgentesOpen(false);
  }, []);

  const value = useMemo<EmailModalContextValue>(
    () => ({
      emailOpen,
      urgentesOpen,
      emailActual,
      urgentes,
      abrirEmail,
      cerrarEmail,
      abrirUrgentes,
      cerrarUrgentes,
    }),
    [
      emailOpen,
      urgentesOpen,
      emailActual,
      urgentes,
      abrirEmail,
      cerrarEmail,
      abrirUrgentes,
      cerrarUrgentes,
    ]
  );

  return <EmailModalContext.Provider value={value}>{children}</EmailModalContext.Provider>;
}

export function useEmailModal() {
  const ctx = useContext(EmailModalContext);
  if (!ctx) {
    throw new Error('useEmailModal debe usarse dentro de EmailModalProvider');
  }
  return ctx;
}
