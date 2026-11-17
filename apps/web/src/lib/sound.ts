/**
 * Short scan beeps. Browsers only allow sound after a tap, so the scanner primes audio when the
 * seller opens it. Silently does nothing where audio is unavailable.
 */
let context: AudioContext | null = null;

export function primeAudio(): void {
  try {
    context ??= new AudioContext();
    void context.resume();
  } catch {
    context = null;
  }
}

export function beep(kind: 'ok' | 'error'): void {
  if (!context) return;
  try {
    const now = context.currentTime;
    const tones =
      kind === 'ok'
        ? [{ at: 0, freq: 1800 }]
        : [
            { at: 0, freq: 300 },
            { at: 0.16, freq: 300 },
          ];
    for (const tone of tones) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = kind === 'ok' ? 'sine' : 'square';
      oscillator.frequency.value = tone.freq;
      gain.gain.setValueAtTime(0.18, now + tone.at);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + tone.at + 0.12);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(now + tone.at);
      oscillator.stop(now + tone.at + 0.13);
    }
  } catch {
    // Audio not available.
  }
}
