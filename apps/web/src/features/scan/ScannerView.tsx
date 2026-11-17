import { createScanGate, normalizeBarcode, type Money } from '@ravin-sales/domain';
import { useEffect, useRef, useState } from 'react';
import { Price } from '../../components/Price.tsx';
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

export interface ScanOutcome {
  readonly ok: boolean;
  readonly message: string;
}

interface ScannerViewProps {
  /** Looks the barcode up and adds the piece; returns what to show the seller. */
  readonly onBarcode: (code: string) => ScanOutcome;
  readonly onClose: () => void;
  readonly pieceCount: number;
  readonly total: Money;
}

const SCAN_INTERVAL_MS = 120;
const SAME_CODE_COOLDOWN_MS = 1500;
/** The shareable demo link runs where the camera is always blocked, whatever the seller allows. */
const CAMERA_BLOCKED_BY_HOST = import.meta.env.MODE === 'artifact';

/**
 * Continuous scanning: the camera stays open, every new barcode adds a piece with a beep and a
 * vibration, and the running total stays visible. Closing returns to the cart.
 */
export function ScannerView({ onBarcode, onClose, pieceCount, total }: ScannerViewProps) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const onBarcodeRef = useRef(onBarcode);
  const [status, setStatus] = useState<'starting' | 'scanning' | CameraProblem>('starting');
  const [last, setLast] = useState<(ScanOutcome & { readonly key: number }) | null>(null);
  const [torch, setTorchState] = useState({ supported: false, on: false });

  useEffect(() => {
    onBarcodeRef.current = onBarcode;
  }, [onBarcode]);

  useEffect(() => {
    primeAudio();
    let cancelled = false;
    let timer: number | undefined;
    const accept = createScanGate(SAME_CODE_COOLDOWN_MS);

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
          if (!document.hidden && video.readyState >= 2) {
            try {
              const found = await detector.detect(video);
              const now = performance.now();
              for (const barcode of found) {
                const code = normalizeBarcode(barcode.rawValue);
                if (code === '' || !accept(code, now)) continue;
                const outcome = onBarcodeRef.current(code);
                beep(outcome.ok ? 'ok' : 'error');
                tick();
                setLast({ ...outcome, key: now });
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

  const frameTone = last === null ? 'border-camera-fg/70' : last.ok ? 'border-free' : 'border-danger';

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col bg-camera text-camera-fg"
      role="dialog"
      aria-modal="true"
      aria-label={t.scanner}
    >
      <header className="gutter pt-safe flex items-center justify-between gap-3 pb-3">
        <h2 className="text-lg font-semibold">{t.scanner}</h2>
        {torch.supported ? (
          <button
            type="button"
            onClick={() => void toggleTorch()}
            aria-pressed={torch.on}
            className={`rounded-full px-4 py-2 text-sm font-semibold ${torch.on ? 'bg-camera-fg text-camera' : 'border border-camera-fg/40'}`}
          >
            {torch.on ? t.flashOff : t.flashOn}
          </button>
        ) : null}
      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <video ref={videoRef} muted playsInline className="absolute inset-0 h-full w-full object-cover" />
        {status === 'scanning' ? (
          <div
            key={last?.key ?? 0}
            aria-hidden="true"
            className={`absolute inset-x-[8%] top-1/2 h-[30%] -translate-y-1/2 rounded-3xl border-4 transition-colors ${frameTone}`}
          />
        ) : (
          <div className="gutter absolute inset-0 flex items-center justify-center text-center">
            <p className="max-w-sm text-base">
              {status === 'starting'
                ? t.cameraStarting
                : CAMERA_BLOCKED_BY_HOST
                  ? t.cameraUnavailable
                  : problemText[status]}
            </p>
          </div>
        )}
      </div>

      <footer className="gutter pb-safe flex flex-col gap-3 pt-3">
        <p
          aria-live="polite"
          className={`min-h-12 rounded-2xl px-4 py-3 text-center font-semibold ${
            last === null ? 'text-camera-fg/80' : last.ok ? 'bg-free-bg text-free' : 'bg-danger-bg text-danger'
          }`}
        >
          {last?.message ?? t.scanHint}
        </p>
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-xs text-camera-fg/70">{t.pieces(pieceCount)}</div>
            <div className="text-2xl font-bold">
              <Price amount={total} />
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-13 rounded-2xl bg-camera-fg px-8 text-lg font-semibold text-camera"
          >
            {t.done}
          </button>
        </div>
      </footer>
    </div>
  );
}
