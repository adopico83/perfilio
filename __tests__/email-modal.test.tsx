/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import EmailModal from '@/components/dashboard/email-modal';
import { EmailModalProvider, useEmailModal } from '@/contexts/email-modal-context';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

function AbrirEmailEjemplo() {
  const { abrirEmail } = useEmailModal();
  useEffect(() => {
    abrirEmail({
      remitente: 'Cliente Demo <demo@correo.com>',
      asunto: 'Presupuesto urgente',
      fechaIso: '2026-03-30T10:00:00.000Z',
      noLeido: true,
      cuerpo: 'Hola, necesito una respuesta hoy.',
    });
  }, [abrirEmail]);
  return <EmailModal />;
}

describe('EmailModal', () => {
  it('renderiza remitente y asunto', async () => {
    render(
      <EmailModalProvider>
        <AbrirEmailEjemplo />
      </EmailModalProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    expect(screen.getByText(/Cliente Demo/i)).toBeInTheDocument();
    expect(screen.getByText('Presupuesto urgente')).toBeInTheDocument();
  });
});
