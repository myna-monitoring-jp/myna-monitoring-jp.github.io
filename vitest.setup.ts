import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// jsdom does not implement scrollTo; several components call it on route change.
if (!window.scrollTo) {
  Object.defineProperty(window, 'scrollTo', { value: () => undefined, writable: true });
}
