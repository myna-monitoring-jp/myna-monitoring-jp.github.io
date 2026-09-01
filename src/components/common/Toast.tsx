import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

interface ToastContextValue {
  showToast: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue>({ showToast: () => undefined });

/** Announces short confirmations (copy succeeded / failed) via aria-live. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((next: string) => {
    setMessage(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(''), 2600);
  }, []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        id="toast"
        className={`toast${message ? ' show' : ''}`}
        role="status"
        aria-live="polite"
        data-testid="toast"
      >
        {message}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}
