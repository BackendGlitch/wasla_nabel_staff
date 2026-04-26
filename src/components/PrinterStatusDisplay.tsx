import { useState, useEffect, useRef } from 'react';
import { printerIpConfigService } from '@/services/printerIpConfigService';

interface PrinterStatus {
  connected: boolean;
  error?: string;
}

interface PrinterStatusDisplayProps {
  onConfigUpdate?: () => void;
}

export default function PrinterStatusDisplay({ onConfigUpdate }: PrinterStatusDisplayProps) {
  const [status, setStatus] = useState<PrinterStatus>({ connected: false });
  const [loading, setLoading] = useState(false);
  const [showIpModal, setShowIpModal] = useState(false);
  const [currentIp, setCurrentIp] = useState('');
  const [newIp, setNewIp] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadPrinterConfig();
  }, []);

  useEffect(() => {
    refreshStatus();
    const interval = setInterval(refreshStatus, 10000);
    return () => clearInterval(interval);
  }, [currentIp]);

  useEffect(() => {
    const handleConfigUpdate = (e: CustomEvent) => {
      const newConfig = e.detail;
      if (newConfig && newConfig.ip !== currentIp) {
        setCurrentIp(newConfig.ip);
        setTimeout(refreshStatus, 500);
      }
    };

    window.addEventListener('printerConfigUpdated', handleConfigUpdate as EventListener);
    return () => window.removeEventListener('printerConfigUpdated', handleConfigUpdate as EventListener);
  }, [currentIp]);

  useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      if (event.key === 'F3') {
        event.preventDefault();
        setShowIpModal(true);
        setNewIp(currentIp);
      }
    };

    document.addEventListener('keydown', handleKeyPress);
    return () => document.removeEventListener('keydown', handleKeyPress);
  }, [currentIp]);

  const loadPrinterConfig = () => {
    try {
      const config = printerIpConfigService.getConfig();
      setCurrentIp(config.ip);
      setNewIp(config.ip);
    } catch (err) {
      console.error('Failed to load printer config:', err);
    }
  };

  const refreshStatus = async () => {
    setLoading(true);
    setError(null);
    try {
      const testStatus = await printerIpConfigService.testPrinterConnection();
      setStatus(testStatus);
    } catch (err) {
      setError(`Échec de la connexion : ${err}`);
      setStatus({ connected: false, error: err as string });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveIp = async () => {
    if (!newIp.trim()) {
      setError("L'adresse IP ne peut pas être vide");
      return;
    }

    if (!printerIpConfigService.isValidIp(newIp.trim())) {
      setError("Format d'adresse IP invalide");
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      printerIpConfigService.setPrinterIp(newIp.trim());
      setCurrentIp(newIp.trim());
      setSuccess("Adresse IP de l'imprimante mise à jour avec succès !");
      onConfigUpdate?.();

      setTimeout(async () => {
        try {
          const testStatus = await printerIpConfigService.testPrinterConnection();
          setStatus(testStatus);
          if (testStatus.connected) {
            setSuccess("IP mise à jour et connexion réussie !");
          } else {
            setError(`IP mise à jour mais la connexion a échoué : ${testStatus.error}`);
          }
        } catch (err) {
          setError(`IP mise à jour mais le test de connexion a échoué : ${err}`);
        }
      }, 1000);

      setTimeout(() => {
        setShowIpModal(false);
        setSuccess(null);
        setError(null);
      }, 2000);
    } catch (err) {
      setError(`Échec de la mise à jour de l'IP de l'imprimante : ${err}`);
    } finally {
      setSaving(false);
    }
  };

  const handleModalOpen = () => {
    setShowIpModal(true);
    setNewIp(currentIp);
    setError(null);
    setSuccess(null);
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      }
    }, 100);
  };

  const handleModalClose = () => {
    setShowIpModal(false);
    setError(null);
    setSuccess(null);
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      handleSaveIp();
    } else if (event.key === 'Escape') {
      handleModalClose();
    }
  };

  return (
    <>
      <div className="flex items-center gap-2 h-9 px-3.5 rounded-lg border border-slate-200 bg-white shadow-sm">
        <div
          className={`w-2 h-2 rounded-full flex-shrink-0 transition-colors ${
            status.connected ? 'bg-emerald-500' : 'bg-red-400'
          } ${loading ? 'animate-pulse' : ''}`}
        />
        <span className="text-xs text-slate-500">
          {status.connected ? 'En ligne' : 'Hors ligne'}
        </span>
        <span className="text-[11px] text-slate-400 font-mono">{currentIp}</span>
        <button
          onClick={handleModalOpen}
          className="text-[11px] font-medium text-blue-600 hover:text-blue-700 transition-colors"
          title="F3"
        >
          Config
        </button>
      </div>

      {showIpModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={handleModalClose}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" />
          <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden" onClick={(e) => e.stopPropagation()} style={{ animation: 'modalIn 0.2s ease-out' }}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h2 className="text-base font-semibold text-slate-800">Configuration imprimante</h2>
              <button onClick={handleModalClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2 block">Adresse IP</label>
                <input ref={inputRef} type="text" value={newIp} onChange={(e) => setNewIp(e.target.value)} onKeyDown={handleKeyDown}
                  placeholder="192.168.192.11"
                  className="w-full h-10 px-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-800 font-mono placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-all" />
                <p className="text-[11px] text-slate-400 mt-1.5">Entrée pour enregistrer, Échap pour annuler. Port: 9100</p>
              </div>

              {error && (
                <div className="p-3 bg-red-50 border border-red-100 rounded-lg">
                  <p className="text-sm text-red-600">{error}</p>
                </div>
              )}
              {success && (
                <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-lg">
                  <p className="text-sm text-emerald-600">{success}</p>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button onClick={handleModalClose} className="h-10 px-4 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
                  Annuler
                </button>
                <button onClick={handleSaveIp} disabled={saving || !newIp.trim()}
                  className="h-10 px-5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed">
                  {saving ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              </div>
            </div>
          </div>
          <style>{`@keyframes modalIn { from { opacity: 0; transform: scale(0.97) translateY(8px); } to { opacity: 1; transform: scale(1) translateY(0); } }`}</style>
        </div>
      )}
    </>
  );
}
