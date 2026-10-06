/** @jest-environment jsdom */
import { act, renderHook, waitFor } from '@testing-library/react';
import { useGrabadoraAudio } from '@/hooks/use-grabadora-audio';

class FakeRecorder {
  static instancias: FakeRecorder[] = [];
  static isTypeSupported = (t: string) => t === 'audio/mp4';
  state: 'inactive' | 'recording' = 'inactive';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  mimeType?: string;
  constructor(public stream: unknown, opts?: { mimeType?: string }) {
    this.mimeType = opts?.mimeType;
    FakeRecorder.instancias.push(this);
  }
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob([new Uint8Array(2000)]) });
    this.onstop?.();
  }
}

const stopTrack = jest.fn();
const getUserMedia = jest.fn();
const mockFetch = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  FakeRecorder.instancias = [];
  stopTrack.mockClear();
  getUserMedia.mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] });
  Object.defineProperty(global.navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
  (global as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeRecorder;
  global.fetch = mockFetch as never;
});

describe('useGrabadoraAudio', () => {
  it('graba, transcribe y devuelve el texto (y avisa con onTexto)', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ texto: ' Hoy se ha alicatado ' }) });
    const onTexto = jest.fn();
    const { result } = renderHook(() => useGrabadoraAudio({ onTexto }));

    act(() => result.current.empezar());
    await waitFor(() => expect(result.current.grabando).toBe(true));
    // Se pide el micro en la misma llamada que el gesto, y se elige el primer formato soportado.
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(FakeRecorder.instancias[0].mimeType).toBe('audio/mp4');

    act(() => result.current.parar());
    await waitFor(() => expect(result.current.texto).toBe('Hoy se ha alicatado'));
    expect(result.current.grabando).toBe(false);
    expect(result.current.transcribiendo).toBe(false);
    expect(onTexto).toHaveBeenCalledWith('Hoy se ha alicatado');
    expect(mockFetch).toHaveBeenCalledWith('/api/transcribe', expect.objectContaining({ method: 'POST' }));
    const form = mockFetch.mock.calls[0][1].body as FormData;
    expect(form.get('audio')).toBeInstanceOf(Blob);
    // El micro se libera al parar.
    expect(stopTrack).toHaveBeenCalled();
  });

  it('muestra el error del servidor si la transcripción falla', async () => {
    mockFetch.mockResolvedValue({ ok: false, json: async () => ({ error: 'Audio demasiado corto o vacío' }) });
    const { result } = renderHook(() => useGrabadoraAudio());
    act(() => result.current.empezar());
    await waitFor(() => expect(result.current.grabando).toBe(true));
    act(() => result.current.parar());
    await waitFor(() => expect(result.current.error).toBe('Audio demasiado corto o vacío'));
    expect(result.current.transcribiendo).toBe(false);
    expect(result.current.texto).toBe('');
  });

  it('permiso de micrófono denegado: mensaje claro y no queda grabando', async () => {
    getUserMedia.mockRejectedValue(Object.assign(new Error('x'), { name: 'NotAllowedError' }));
    const { result } = renderHook(() => useGrabadoraAudio());
    act(() => result.current.empezar());
    await waitFor(() => expect(result.current.error).toMatch(/Permiso denegado/));
    expect(result.current.grabando).toBe(false);
  });

  it('sin MediaRecorder avisa de que el navegador no lo soporta', () => {
    delete (global as unknown as { MediaRecorder?: unknown }).MediaRecorder;
    const { result } = renderHook(() => useGrabadoraAudio());
    act(() => result.current.empezar());
    expect(result.current.error).toMatch(/no soporta/);
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('apaga el micro si el componente se desmonta mientras graba', async () => {
    const { result, unmount } = renderHook(() => useGrabadoraAudio());
    act(() => result.current.empezar());
    await waitFor(() => expect(result.current.grabando).toBe(true));
    unmount();
    expect(stopTrack).toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
