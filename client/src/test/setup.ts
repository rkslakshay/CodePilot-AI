import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => cleanup());

// React Router's data router builds Request objects with jsdom's AbortSignal, which Node's
// undici Request rejects. Drop the signal in tests (navigation is never aborted here).
const NodeRequest = globalThis.Request;
class TestRequest extends NodeRequest {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    if (init?.signal) {
      const rest = { ...init };
      delete rest.signal;
      super(input, rest);
    } else super(input, init);
  }
}
globalThis.Request = TestRequest as typeof Request;
