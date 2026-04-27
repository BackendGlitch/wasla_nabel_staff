import { useCallback, useEffect, useRef, useState } from "react";

import type {
  WaslaPrinterHealth,
  WaslaPrinterHealthStatus,
} from "@/types/electron";

const DRIVER_MISSING_HINT = "CH341 driver not installed";

const POLL_INTERVAL_MS = 30_000;

type PillTone = "ok" | "warn" | "error" | "idle";

interface DerivedView {
  tone: PillTone;
  label: string;
  hint: string;
}

function deriveView(
  health: WaslaPrinterHealth | null,
  error: string | null,
): DerivedView {
  if (error) {
    return { tone: "error", label: "USB indispo.", hint: error };
  }
  if (!health) {
    return {
      tone: "idle",
      label: "USB…",
      hint: "Vérification de l’imprimante locale",
    };
  }
  switch (health.status) {
    case "ok":
      return { tone: "ok", label: "USB prête", hint: health.device };
    case "missing":
      return {
        tone: "error",
        label: "USB absente",
        hint: `${health.device} introuvable`,
      };
    case "unreadable":
    case "unwritable":
      return {
        tone: "error",
        label: "USB bloquée",
        hint: `Permission refusée sur ${health.device}`,
      };
    case "not-character-device":
      return {
        tone: "error",
        label: "USB invalide",
        hint: `${health.device} n’est pas un périphérique d’imprimante`,
      };
    case "unknown-error":
    default:
      return {
        tone: "error",
        label: "USB erreur",
        hint: health.error || `Erreur sur ${health.device}`,
      };
  }
}

const TONE_DOT: Record<PillTone, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-400",
  error: "bg-red-500",
  idle: "bg-slate-300 animate-pulse",
};

const TONE_LABEL: Record<PillTone, string> = {
  ok: "text-emerald-700",
  warn: "text-amber-700",
  error: "text-red-600",
  idle: "text-slate-500",
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
  const [installing, setInstalling] = useState(false);
  const [installResult, setInstallResult] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  const refresh = useCallback(async () => {
    const bridge = typeof window !== "undefined" ? window.wasla : undefined;
    if (!bridge?.checkPrinter) {
      setError("Bridge USB indisponible");
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
      setError(
        err instanceof Error ? err.message : "Erreur de vérification USB",
      );
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

  const needsDriver =
    health?.status === "missing" &&
    health?.error?.includes(DRIVER_MISSING_HINT);

  const handleInstallDriver = useCallback(async () => {
    const bridge = typeof window !== "undefined" ? window.wasla : undefined;
    if (!bridge?.installCh341Driver) {
      setInstallResult("Installation non disponible depuis cette interface");
      return;
    }
    setInstalling(true);
    setInstallResult(null);
    try {
      const result = await bridge.installCh341Driver();
      if (cancelledRef.current) return;
      if (result.success) {
        setInstallResult(
          "✅ Pilote installé avec succès ! Redémarrez l'application.",
        );
        // Refresh health check after driver install
        setTimeout(() => void refresh(), 3000);
      } else {
        setInstallResult(`❌ Échec: ${result.error || "Erreur inconnue"}`);
      }
    } catch (err) {
      if (cancelledRef.current) return;
      setInstallResult(
        `❌ Erreur: ${err instanceof Error ? err.message : "Erreur inconnue"}`,
      );
    } finally {
      if (!cancelledRef.current) setInstalling(false);
    }
  }, [refresh]);

  const view = deriveView(health, error);
  const tooltip = [
    view.hint,
    health?.device ? `Périphérique: ${health.device}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => void refresh()}
        disabled={checking}
        title={tooltip || "Imprimante USB"}
        aria-label={`Imprimante USB — ${view.label}. Toucher pour revérifier.`}
        className="flex items-center gap-2 h-9 px-3.5 rounded-lg border border-slate-200 bg-white shadow-sm hover:bg-slate-50 transition-colors disabled:opacity-70"
      >
        <span
          className={`w-2 h-2 rounded-full flex-shrink-0 transition-colors ${TONE_DOT[view.tone]} ${
            checking ? "animate-pulse" : ""
          }`}
        />
        <span className={`text-xs font-medium ${TONE_LABEL[view.tone]}`}>
          {view.label}
        </span>
      </button>

      {needsDriver && !installing && !installResult && (
        <button
          type="button"
          onClick={handleInstallDriver}
          title="Télécharger et installer le pilote CH341 pour l'imprimante ZKP8003"
          className="flex items-center gap-1.5 h-9 px-3 rounded-lg border border-amber-300 bg-amber-50 text-amber-700 text-xs font-medium shadow-sm hover:bg-amber-100 transition-colors"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
            />
          </svg>
          Installer pilote
        </button>
      )}

      {installing && (
        <span className="flex items-center gap-1.5 h-9 px-3 text-xs text-amber-600 font-medium">
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          Installation...
        </span>
      )}

      {installResult && (
        <span
          className={`text-xs font-medium max-w-[200px] truncate ${installResult.includes("✅") ? "text-emerald-600" : "text-red-600"}`}
        >
          {installResult}
        </span>
      )}
    </div>
  );
}

export type { WaslaPrinterHealth, WaslaPrinterHealthStatus };
