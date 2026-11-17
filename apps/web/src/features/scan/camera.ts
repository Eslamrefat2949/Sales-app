import { BarcodeDetector as ZXingBarcodeDetector, prepareZXingModule } from 'barcode-detector/ponyfill';
import zxingWasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

/** Tag barcodes are ITEMCODE-SIZE (letters, digits, dash), so Code 128 and Code 39 matter most. */
const FORMATS = ['code_128', 'code_39', 'ean_13', 'qr_code'] as const;

export interface Detector {
  detect(source: HTMLVideoElement): Promise<readonly { rawValue: string }[]>;
}

interface NativeDetectorClass {
  new (options: { formats: string[] }): Detector;
  getSupportedFormats(): Promise<string[]>;
}

let zxingPrepared = false;

/**
 * Uses the phone's built-in barcode reader when it has one (Chrome on Android), otherwise the bundled
 * ZXing engine (iPhone, desktop). The engine is served by the app itself, so scanning works offline.
 */
export async function createDetector(): Promise<Detector> {
  const Native = (globalThis as { BarcodeDetector?: NativeDetectorClass }).BarcodeDetector;
  if (Native) {
    try {
      const supported = await Native.getSupportedFormats();
      const formats = FORMATS.filter((format) => supported.includes(format));
      if (formats.includes('code_128')) return new Native({ formats });
    } catch {
      // Fall back to ZXing.
    }
  }
  if (!zxingPrepared) {
    prepareZXingModule({
      overrides: {
        locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? zxingWasmUrl : prefix + path),
      },
    });
    zxingPrepared = true;
  }
  return new ZXingBarcodeDetector({ formats: [...FORMATS] });
}

export type CameraProblem = 'unsupported' | 'denied' | 'not_found' | 'failed';

export function classifyCameraError(error: unknown): CameraProblem {
  const name = error instanceof DOMException || error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'not_found';
  if (name === 'TypeError' || name === 'NotSupportedError') return 'unsupported';
  return 'failed';
}

/** Opens the back camera into the given video element. */
export async function openCamera(video: HTMLVideoElement): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new DOMException('Camera API missing', 'NotSupportedError');
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
  });
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();
  return stream;
}

export function stopCamera(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

function videoTrack(stream: MediaStream): MediaStreamTrack | undefined {
  return stream.getVideoTracks()[0];
}

export function torchSupported(stream: MediaStream): boolean {
  const capabilities = videoTrack(stream)?.getCapabilities?.() as { torch?: boolean } | undefined;
  return capabilities?.torch === true;
}

export async function setTorch(stream: MediaStream, on: boolean): Promise<boolean> {
  try {
    await videoTrack(stream)?.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
    return true;
  } catch {
    return false;
  }
}
