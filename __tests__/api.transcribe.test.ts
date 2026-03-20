import { NextRequest, NextResponse } from 'next/server';

import { middleware } from '@/middleware';

const transcriptionsCreate = jest.fn();

jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    audio: {
      transcriptions: {
        create: transcriptionsCreate,
      },
    },
  })),
}));

jest.mock('@/lib/supabase/middleware', () => ({
  updateSession: jest.fn(),
}));

import { updateSession } from '@/lib/supabase/middleware';

describe('POST /api/transcribe', () => {
  let POST: (req: NextRequest) => Promise<Response>;

  beforeAll(async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    const mod = await import('@/app/api/transcribe/route');
    POST = mod.POST;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    transcriptionsCreate.mockResolvedValue({ text: 'Texto transcrito' });
  });

  it('devuelve 400 si no se envía audio', async () => {
    const form = new FormData();
    const req = new NextRequest('http://localhost/api/transcribe', {
      method: 'POST',
      body: form,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/Audio/);
  });

  it('devuelve { texto: string } con audio válido mockeando Whisper', async () => {
    const buf = new Uint8Array(1500).fill(7);
    const blob = new Blob([buf], { type: 'audio/mpeg' });
    const form = new FormData();
    form.append('audio', blob, 'a.mp3');

    const req = new NextRequest('http://localhost/api/transcribe', {
      method: 'POST',
      body: form,
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ texto: 'Texto transcrito' });
    expect(transcriptionsCreate).toHaveBeenCalled();
  });

  it('devuelve 400 si el audio es demasiado pequeño (< 1000 bytes)', async () => {
    const buf = new Uint8Array(500).fill(1);
    const blob = new Blob([buf], { type: 'audio/mpeg' });
    const form = new FormData();
    form.append('audio', blob, 'a.mp3');
    const req = new NextRequest('http://localhost/api/transcribe', {
      method: 'POST',
      body: form,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Audio demasiado corto o vacío');
    expect(transcriptionsCreate).not.toHaveBeenCalled();
  });
});

describe('middleware — /api/transcribe sin sesión', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('devuelve 401 sin usuario (API protegida)', async () => {
    (updateSession as jest.Mock).mockResolvedValue({
      supabaseResponse: NextResponse.next(),
      user: null,
    });

    const req = new NextRequest(new URL('http://localhost/api/transcribe'), {
      method: 'POST',
    });
    const res = await middleware(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toMatch(/autorizado|No autorizado/i);
  });
});
