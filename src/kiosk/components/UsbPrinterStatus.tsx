import { useCallback, useEffect, useRef, useState } from 'react';

import type { WaslaPrinterHealth, WaslaPrinterHealthStatus } from '@/types/electron';

const POLL_INTERVAL_MS = 30_000;

type PillTone = 'ok' | 'warn' | 'error' | 'idle';

interface DerivedView {
  tone: PillTone;
  label: string;
  hint: string;
}

function deriveView(health: WaslaPrinterHealth | null, error: string | null): DerivedView {
  if (error) {
    return { tone: 'error', label: 'USB indispo.', hint: error };
  }
  if (!health) {
    return { tone: 'idle', label: 'USB…', hint: 'Vérification de l’imprimante locale' };
  }
  switch (health.status) {
    case 'ok':
      return { tone: 'ok', label: 'USB prête', hint: health.device };
    case 'missing':
      return { tone: 'error', label: 'USB absente', hint: `${health.device} introuvable` };
    case 'unreadable':
    case 'unwritable':
      return {
        tone: 'error',
        label: 'USB bloquée',
        hint: `Permission refusée sur ${health.device}`,
      };
    case 'not-character-device':
      return {
        tone: 'error',
        label: 'USB invalide',
        hint: `${health.device} n’est pas un périphérique d’imprimante`,
      };
    case 'unknown-error':
    default:
      return {
        tone: 'error',
        label: 'USB erreur',
        hint: health.error || `Erreur sur ${health.device}`,
      };
  }
}

const TONE_DOT: Record<PillTone, string> = {
  ok: 'bg-emerald-500',
  warn: 'bg-amber-400',
  error: 'bg-red-500',
  idle: 'bg-slate-300 animate-pulse',
};

const TONE_LABEL: Record<PillTone, string> = {
  ok: 'text-emerald-700',
  warn: 'text-amber-700',
  error: 'text-red-600',
  idle: 'text-slate-500',
};

/**
 * Kiosk USB printer status pill.
 *
 * POS-mode replacement for the IP-based `PrinterStatusDisplay`. Surfaces only
 * the local USB printer health reported by the Electron main process via
 * `window.wasla.checkPrinter()`. There is intentionally no IP, no port, and no
 * configuration affordance — POS mode prints directly over USB and the device
 * path is fixed by the staff machine deployment (`STAFF_PRINTER_DEVICE`).
 *
 * Outside Electron (browser dev) the bridge is unavailable; we render an idle
 * pill rather than crashing so the rest of the shell is still usable.
 */
export default function UsbPrinterStatus() {
  const [health, setHealth] = useState<WaslaPrinterHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const cancelledRef = useRef(false);

  const refresh = useCallback(async () => {
    const bridge = typeof window !== 'undefined' ? window.wasla : undefined;
    if (!bridge?.checkPrinter) {
      setError('Bridge USB indisponible');
      setHealth(null);
      return;
    }
    setChecking(true);
    try {
      const result = await bridge.checkPrinter();
      if (cancelledRef.current) return;
      setHealth(result);
      setError(null);
    } catch (err) {
      if (cancelledRef.current) return;
      setHealth(null);
      setError(err instanceof Error ? err.message : 'Erreur de vérification USB');
    } finally {
      if (!cancelledRef.current) setChecking(false);
    }
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    void refresh();
    const id = window.setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);
    return () => {
      cancelledRef.current = true;
      window.clearInterval(id);
    };
  }, [refresh]);

  const view = deriveView(health, error);
  const tooltip = [view.hint, health?.device ? `Périphérique: ${health.device}` : null]
    .filter(Boolean)
    .join('\n');

  return (
    <button
      type="button"
      onClick={() => void refresh()}
      disabled={checking}
      title={tooltip || 'Imprimante USB'}
      aria-label={`Imprimante USB — ${view.label}. Toucher pour revérifier.`}
      className="flex items-center gap-2 h-9 px-3.5 rounded-lg border border-slate-200 bg-white shadow-sm hover:bg-slate-50 transition-colors disabled:opacity-70"
    >
      <span
        className={`w-2 h-2 rounded-full flex-shrink-0 transition-colors ${TONE_DOT[view.tone]} ${
          checking ? 'animate-pulse' : ''
        }`}
      />
      <span className={`text-xs font-medium ${TONE_LABEL[view.tone]}`}>{view.label}</span>
    </button>
  );
}

export type { WaslaPrinterHealth, WaslaPrinterHealthStatus };
