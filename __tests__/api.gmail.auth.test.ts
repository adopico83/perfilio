import { NextRequest } from 'next/server';

import { GET as getGmailAuth } from '@/app/api/auth/gmail/route';
import { GET as getGmailCallback } from '@/app/api/auth/gmail/callback/route';
import { createClient, createServiceClient } from '@/lib/supabase/server';

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
  createServiceClient: jest.fn(),
}));

describe('GET /api/auth/gmail', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('devuelve { url: string } con las variables de entorno correctas', async () => {
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';

    const res = await getGmailAuth();

    expect(res.status).toBe(200);
    const json = (await res.json()) as { url: string };
    expect(typeof json.url).toBe('string');
    expect(json.url).toContain('https://accounts.google.com/o/oauth2/v2/auth');
    expect(json.url).toContain('client_id=test-client-id');
    expect(json.url).toContain(
      encodeURIComponent('http://localhost:3000/api/auth/gmail/callback')
    );
    expect(json.url).toContain('response_type=code');
  });

  it('devuelve 500 si faltan variables de entorno', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';

    const res = await getGmailAuth();

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toMatch(/entorno|Faltan/i);
  });
});

describe('GET /api/auth/gmail/callback', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GOOGLE_CLIENT_ID = 'cid';
    process.env.GOOGLE_CLIENT_SECRET = 'secret';
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    (globalThis as unknown as { fetch: jest.Mock }).fetch = jest.fn();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('redirige a /dashboard?gmail=error_code si no hay código', async () => {
    const req = new NextRequest('http://localhost:3000/api/auth/gmail/callback');
    const res = await getGmailCallback(req);

    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    const loc = res.headers.get('location') ?? '';
    expect(loc).toContain('/dashboard');
    expect(loc).toContain('gmail=error_code');
  });

  it('redirige a /dashboard?gmail=connected con código válido mockeando Google OAuth', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expires_in: 3600,
      }),
    });

    (createClient as jest.Mock).mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: 'user-uuid' } },
        }),
      },
    });

    const upsertMock = jest.fn().mockResolvedValue({ error: null });
    (createServiceClient as jest.Mock).mockReturnValue({
      from: jest.fn(() => ({
        upsert: upsertMock,
      })),
    });

    const req = new NextRequest(
      'http://localhost:3000/api/auth/gmail/callback?code=auth-code-123'
    );
    const res = await getGmailCallback(req);

    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    const loc = res.headers.get('location') ?? '';
    expect(loc).toContain('/dashboard');
    expect(loc).toContain('gmail=connected');

    expect(global.fetch).toHaveBeenCalled();
    expect(upsertMock).toHaveBeenCalled();
  });
});
