import { useEffect, useId, useRef, type ReactNode } from 'react';

interface SheetProps {
  readonly title: ReactNode;
  readonly subtitle?: ReactNode;
  readonly closeLabel: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}

/** Bottom sheet for quick choices (sizes, offer). Closes on the backdrop, the close button or Escape. */
export function Sheet({ title, subtitle, closeLabel, onClose, children, footer }: SheetProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center">
      <div className="absolute inset-0 bg-scrim backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="animate-rise gutter pb-safe relative flex max-h-[88%] w-full max-w-xl flex-col gap-4 rounded-t-[28px] bg-surface pt-3 shadow-2xl outline-none"
      >
        <div className="mx-auto h-1.5 w-11 rounded-full bg-line" aria-hidden="true" />
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={titleId} className="font-display text-xl font-semibold text-balance">
              {title}
            </h2>
            {subtitle ? <div className="text-sm text-muted">{subtitle}</div> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="press shrink-0 rounded-full bg-surface-2 px-3.5 py-1.5 text-sm font-semibold"
          >
            {closeLabel}
          </button>
        </header>
        <div className="min-h-0 overflow-y-auto">{children}</div>
        {footer ? <footer className="flex flex-col gap-2">{footer}</footer> : null}
      </section>
    </div>
  );
}
