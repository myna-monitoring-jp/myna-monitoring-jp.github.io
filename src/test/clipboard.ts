import { vi } from 'vitest';

/**
 * `navigator.clipboard` is a getter-only property in jsdom, so it must be
 * replaced with `defineProperty` rather than `Object.assign`.
 */
export function stubClipboard(writeText: ReturnType<typeof vi.fn>): void {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
    writable: true,
  });
}

export function removeClipboard(): void {
  Object.defineProperty(navigator, 'clipboard', {
    value: undefined,
    configurable: true,
    writable: true,
  });
}

export function stubExecCommand(result: boolean): ReturnType<typeof vi.fn> {
  const execCommand = vi.fn().mockReturnValue(result);
  Object.defineProperty(document, 'execCommand', {
    value: execCommand,
    configurable: true,
    writable: true,
  });
  return execCommand;
}
