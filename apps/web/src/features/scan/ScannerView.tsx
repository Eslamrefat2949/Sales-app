import { createScanGate, normalizeBarcode, type Money } from '@ravin-sales/domain';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/Icon.tsx';
import { Code, Price } from '../../components/Price.tsx';
import type { CatalogItem, CatalogVariant } from '../../data/appData.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { beep, primeAudio } from '../../lib/sound.ts';
import { tick } from '../../lib/storage.ts';
import {
  classifyCameraError,
  createDetector,
  openCamera,
  setTorch,
  stopCamera,
  torchSupported,
  type CameraProblem,
} from './camera.ts';

export interface ScanMatch {
  readonly item: CatalogItem;
  readonly variant: CatalogVariant;
}

interface ScannerViewProps {
  readonly lookup: (code: string) => ScanMatch | null;
  /** Price after the default discount, or null for items sold without discount. */
  readonly priceAfterDiscount: (variant: CatalogVariant) => Money | null;
  readonly inCart: (barcode: string) => number;
  readonly onConfirm: (match: ScanMatch) => void;
  readonly onClose: () => void;
  readonly pieceCount: number;
  readonly total: Money;
}

type Found =
  { readonly kind: 'match'; readonly match: ScanMatch } | { readonly kind: 'unknown'; readonly code: string };

const SCAN_INTERVAL_MS = 110;
const SAME_CODE_COOLDOWN_MS = 1500;

/**
 * Scan, check, tap Done, next. The camera pauses on every barcode and shows the piece; nothing is added
 * until the seller confirms, and the same label is ignored until it has left the camera's view.
 */
export function ScannerView({
  lookup,
  priceAfterDiscount,
  inCart,
  onConfirm,
  onClose,
  pieceCount,
  total,
}: ScannerViewProps) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lookupRef = useRef(lookup);
  const pausedRef = useRef(false);
  const gateRef = useRef(createScanGate(SAME_CODE_COOLDOWN_MS));
  const [status, setStatus] = useState<'starting' | 'scanning' | CameraProblem>('starting');
  const [found, setFound] = useState<Found | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [torch, setTorchState] = useState({ supported: false, on: false });

  useEffect(() => {
    lookupRef.current = lookup;
  }, [lookup]);

  // Keep the screen awake while scanning.
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> };
    };
    nav.wakeLock
      ?.request('screen')
      .then((granted) => (lock = granted))
      .catch(() => undefined);
    return () => void lock?.release().catch(() => undefined);
  }, []);

  useEffect(() => {
    primeAudio();
    let cancelled = false;
    let timer: number | undefined;

    const start = async () => {
      const video = videoRef.current;
      if (!video) return;
      try {
        const stream = await openCamera(video);
        if (cancelled) {
          stopCamera(stream);
          return;
        }
        streamRef.current = stream;
        setTorchState({ supported: torchSupported(stream), on: false });
        const detector = await createDetector();
        if (cancelled) return;
        setStatus('scanning');

        const scan = async () => {
          if (cancelled) return;
          if (!pausedRef.current && !document.hidden && video.readyState >= 2) {
            try {
              const codes = await detector.detect(video);
              const now = performance.now();
              for (const barcode of codes) {
                const code = normalizeBarcode(barcode.rawValue);
                if (code === '' || pausedRef.current || !gateRef.current(code, now)) continue;
                const match = lookupRef.current(code);
                pausedRef.current = true;
                beep(match ? 'ok' : 'error');
                tick();
                setFound(match ? { kind: 'match', match } : { kind: 'unknown', code });
                break;
              }
            } catch {
              // Frame not ready yet; try the next one.
            }
          }
          timer = window.setTimeout(() => void scan(), SCAN_INTERVAL_MS);
        };
        void scan();
      } catch (error) {
        if (!cancelled) setStatus(classifyCameraError(error));
      }
    };
    void start();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (streamRef.current) stopCamera(streamRef.current);
      streamRef.current = null;
    };
  }, []);

  /** Back to scanning; the label just handled stays ignored until it leaves the camera's view. */
  const resume = (code: string) => {
    gateRef.current(code, performance.now());
    setFound(null);
    pausedRef.current = false;
  };

  const confirm = (match: ScanMatch) => {
    onConfirm(match);
    setFlash(t.added(match.item.itemCode, match.variant.size));
    window.setTimeout(() => setFlash(null), 1400);
    resume(normalizeBarcode(match.variant.barcode));
  };

  const toggleTorch = async () => {
    const stream = streamRef.current;
    if (!stream) return;
    const next = !torch.on;
    if (await setTorch(stream, next)) setTorchState({ supported: true, on: next });
  };

  const problemText: Record<CameraProblem, string> = {
    unsupported: t.cameraUnavailable,
    failed: t.cameraUnavailable,
    denied: t.cameraDenied,
    not_found: t.cameraNotFound,
  };

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col bg-camera text-camera-fg"
      role="dialog"
      aria-modal="true"
      aria-label={t.scanner}
    >
      <video ref={videoRef} muted playsInline className="absolute inset-0 h-full w-full object-cover" />

      {status === 'scanning' ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-[9%] top-[24%] h-[24%] rounded-[28px] shadow-[0_0_0_200vmax_rgb(0_0_0/0.5)]"
        >
          {[
            'top-0 left-0 border-t-4 border-l-4 rounded-tl-[28px]',
            'top-0 right-0 border-t-4 border-r-4 rounded-tr-[28px]',
            'bottom-0 left-0 border-b-4 border-l-4 rounded-bl-[28px]',
            'bottom-0 right-0 border-b-4 border-r-4 rounded-br-[28px]',
          ].map((corner) => (
            <span key={corner} className={`absolute h-10 w-10 border-camera-fg ${corner}`} />
          ))}
          {found === null ? (
            <span
              className="absolute inset-x-6 top-3 h-0.5 rounded-full bg-primary-2 shadow-[0_0_14px_3px_var(--primary-2)]"
              style={{
                animation: 'scan-line 1.6s ease-in-out infinite alternate',
                ['--travel' as string]: 'calc(24vh - 24px)',
              }}
            />
          ) : null}
        </div>
      ) : null}

      <header className="gutter pt-safe relative flex items-center justify-between gap-3 pb-3">
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-2 rounded-full bg-black/45 px-4 py-2.5 text-sm font-semibold backdrop-blur"
        >
          <Icon name="close" />
          {t.finishScanning}
        </button>
        {torch.supported ? (
          <button
            type="button"
            onClick={() => void toggleTorch()}
            aria-pressed={torch.on}
            className={`flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold backdrop-blur ${
              torch.on ? 'bg-camera-fg text-camera' : 'bg-black/45'
            }`}
          >
            <Icon name="bolt" />
            {torch.on ? t.flashOff : t.flashOn}
          </button>
        ) : null}
      </header>

      <div className="relative flex-1">
        {status !== 'scanning' ? (
          <div className="gutter absolute inset-0 flex items-center justify-center text-center">
            <p className="max-w-sm text-base">{status === 'starting' ? t.cameraStarting : problemText[status]}</p>
          </div>
        ) : null}
      </div>

      <footer className="gutter pb-safe relative flex flex-col gap-3 pt-3">
        {found?.kind === 'match' ? (
          <ConfirmCard
            match={found.match}
            priceAfterDiscount={priceAfterDiscount(found.match.variant)}
            alreadyInCart={inCart(found.match.variant.barcode)}
            onConfirm={() => confirm(found.match)}
            onSkip={() => resume(normalizeBarcode(found.match.variant.barcode))}
          />
        ) : found?.kind === 'unknown' ? (
          <div className="animate-rise flex flex-col gap-3 rounded-3xl bg-surface p-5 text-fg shadow-card">
            <div className="flex items-center gap-3 text-danger">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-danger-bg">
                <Icon name="close" />
              </span>
              <p className="font-semibold">{t.unknownBarcode}</p>
            </div>
            <Code className="text-xl font-semibold">{found.code}</Code>
            <button
              type="button"
              onClick={() => resume(found.code)}
              className="h-14 rounded-2xl bg-primary text-lg font-semibold text-primary-fg press"
            >
              {t.backToScan}
            </button>
          </div>
        ) : (
          <>
            {flash ? (
              <p
                className="animate-rise self-center rounded-full bg-free px-4 py-2 text-sm font-semibold text-surface"
                role="status"
              >
                {flash}
              </p>
            ) : (
              <p className="self-center rounded-full bg-black/45 px-4 py-2 text-sm backdrop-blur">{t.scanHint}</p>
            )}
            <div className="flex items-center justify-between rounded-2xl bg-black/55 px-4 py-3 backdrop-blur">
              <span className="text-sm opacity-80">{t.pieces(pieceCount)}</span>
              <span className="font-display text-xl font-semibold">
                <Price amount={total} />
              </span>
            </div>
          </>
        )}
      </footer>
    </div>
  );
}

function ConfirmCard({
  match,
  priceAfterDiscount,
  alreadyInCart,
  onConfirm,
  onSkip,
}: {
  readonly match: ScanMatch;
  readonly priceAfterDiscount: Money | null;
  readonly alreadyInCart: number;
  readonly onConfirm: () => void;
  readonly onSkip: () => void;
}) {
  const { t } = useI18n();
  const { item, variant } = match;
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => confirmRef.current?.focus(), []);

  return (
    <div className="animate-rise flex flex-col gap-4 rounded-3xl bg-surface p-5 text-fg shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Code className="font-display text-2xl font-semibold">{item.itemCode}</Code>
          {item.name ? <p className="truncate text-sm text-muted">{item.name}</p> : null}
        </div>
        <span className="rounded-xl bg-primary px-3 py-1.5 font-mono text-lg font-semibold text-primary-fg" dir="ltr">
          {variant.size}
        </span>
      </div>

      <div className="flex items-end justify-between gap-3 border-t border-line pt-3">
        <div className="flex flex-col text-sm">
          {variant.listPrice > variant.salePrice ? (
            <s className="text-muted">
              {t.before} <Price amount={variant.listPrice} />
            </s>
          ) : null}
          <span>
            {t.after} <Price amount={variant.salePrice} className="font-semibold" />
          </span>
        </div>
        <div className="text-end">
          <div className="text-xs font-semibold text-primary">
            {priceAfterDiscount === null ? t.treatmentNoDiscount : t.afterDiscount}
          </div>
          <div className="font-display text-3xl font-semibold">
            <Price amount={priceAfterDiscount ?? variant.salePrice} />
          </div>
        </div>
      </div>
      {alreadyInCart > 0 ? <p className="text-sm text-paid">{t.inCart(alreadyInCart)}</p> : null}

      <div className="grid grid-cols-[1fr_2fr] gap-3">
        <button
          type="button"
          onClick={onSkip}
          className="h-16 rounded-2xl border border-line text-base font-semibold text-muted"
        >
          {t.skip}
        </button>
        <button
          ref={confirmRef}
          type="button"
          onClick={onConfirm}
          className="flex h-16 items-center justify-center gap-2 rounded-2xl bg-free text-xl font-semibold text-surface active:scale-[0.98]"
        >
          {t.confirmAdd}
        </button>
      </div>
    </div>
  );
}
