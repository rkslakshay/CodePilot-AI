/** Typed fetch wrapper for the local CodePilot API ({ ok, data } / { ok: false, error }). */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${url}`, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'network_error', 'Cannot reach the local CodePilot server. Is it running (npm run dev)?');
  }
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    throw new ApiError(res.status, 'bad_response', `Unexpected response from server (${res.status})`);
  }
  if (!res.ok || !json?.ok) {
    const err = json?.error ?? {};
    let message: string = err.message ?? `Request failed (${res.status})`;
    if (Array.isArray(err.details) && err.details.length) message = err.details.map((d: any) => d.message).join(' · ');
    throw new ApiError(res.status, err.code ?? 'error', message, err.details);
  }
  return json.data as T;
}

export const api = {
  get: <T>(url: string, signal?: AbortSignal) => request<T>('GET', url, undefined, signal),
  post: <T>(url: string, body?: unknown, signal?: AbortSignal) => request<T>('POST', url, body ?? {}, signal),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body ?? {}),
  del: <T>(url: string) => request<T>('DELETE', url),
  patch: <T>(url: string, body?: unknown) => request<T>('PATCH', url, body ?? {}),
  /** Uploads a binary file as the raw request body (used for ZIP imports). */
  upload: async <T>(url: string, file: File, signal?: AbortSignal): Promise<T> => {
    let res: Response;
    try {
      res = await fetch(`/api${url}`, { method: 'POST', headers: { 'content-type': 'application/zip', 'x-file-name': encodeURIComponent(file.name) }, body: file, signal });
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      throw new ApiError(0, 'network_error', 'Cannot reach the local CodePilot server.');
    }
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) throw new ApiError(res.status, json?.error?.code ?? 'error', json?.error?.message ?? `Upload failed (${res.status})`);
    return json.data as T;
  },
};
