'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import styles from './notify.module.css';

export interface PromptOptions {
  title?: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  type?: 'text' | 'password';
  /** Returns an error message to show inline, or null/undefined if the value is acceptable. */
  validate?: (value: string) => string | null | undefined;
}

interface PendingPrompt extends PromptOptions {
  resolve: (value: string | null) => void;
}

const PromptContext = createContext<((options: PromptOptions) => Promise<string | null>) | null>(null);

export function PromptProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<PendingPrompt | null>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const promptText = useCallback((options: PromptOptions) => {
    return new Promise<string | null>((resolve) => {
      setValue(options.defaultValue ?? '');
      setError('');
      setPending({ ...options, resolve });
    });
  }, []);

  useEffect(() => {
    if (pending) inputRef.current?.focus();
  }, [pending]);

  function respond(result: string | null) {
    pending?.resolve(result);
    setPending(null);
  }

  function submit() {
    if (!pending) return;
    const trimmed = value.trim();
    const validationError = pending.validate?.(trimmed);
    if (validationError) {
      setError(validationError);
      return;
    }
    respond(trimmed);
  }

  return (
    <PromptContext.Provider value={promptText}>
      {children}
      {pending && (
        <div className={styles.overlay} role="presentation" onClick={() => respond(null)}>
          <div className={styles.confirmCard} role="dialog" aria-modal="true" aria-label={pending.title || 'Enter a value'} onClick={(e) => e.stopPropagation()}>
            <div className={styles.confirmTitle}>{pending.title || 'Enter a value'}</div>
            {pending.message && <div className={styles.confirmMessage}>{pending.message}</div>}
            <input
              ref={inputRef}
              type={pending.type === 'password' ? 'password' : 'text'}
              className={styles.promptInput}
              value={value}
              placeholder={pending.placeholder}
              onChange={(e) => {
                setValue(e.target.value);
                if (error) setError('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
                if (e.key === 'Escape') respond(null);
              }}
            />
            {error && <div className={styles.promptError}>{error}</div>}
            <div className={styles.confirmActions}>
              <button type="button" className={styles.confirmCancel} onClick={() => respond(null)}>
                {pending.cancelLabel || 'Cancel'}
              </button>
              <button type="button" className={styles.confirmOk} onClick={submit}>
                {pending.confirmLabel || 'OK'}
              </button>
            </div>
          </div>
        </div>
      )}
    </PromptContext.Provider>
  );
}

// Replaces window.prompt(...) everywhere — await promptText({ title, defaultValue })
// resolves to the trimmed string, or null if cancelled.
export function usePrompt() {
  const promptText = useContext(PromptContext);
  if (!promptText) throw new Error('usePrompt must be used within a PromptProvider');
  return promptText;
}
