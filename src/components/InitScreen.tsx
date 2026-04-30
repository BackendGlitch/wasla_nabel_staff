import { useEffect, useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  healthAuth,
  healthBooking,
  healthQueue,
  healthWS,
  fetchInit,
  type InitData,
} from "@/api/client";
import { API } from "@/config";

type Props = { onReady: (init: InitData) => void };

export default function InitScreen({ onReady }: Props) {
  const [phase, setPhase] = useState<"connecting" | "loading-assets" | "error">("connecting");
  const [initData, setInitData] = useState<InitData | null>(null);
  const [logoSrc, setLogoSrc] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [serviceStatus, setServiceStatus] = useState<Record<string, boolean | null>>({
    auth: null, queue: null, booking: null, ws: null,
  });
  const calledReady = useRef(false);

  const bootstrap = async () => {
    calledReady.current = false;
    setPhase("connecting");
    setErrorMsg("");
    setServiceStatus({ auth: null, queue: null, booking: null, ws: null });

    try {
      // 1. Fetch init data + health checks in parallel
      const [initRes, a, q, b, w] = await Promise.all([
        fetchInit().catch(() => null),
        healthAuth().catch(() => ({ ok: false })),
        healthQueue().catch(() => ({ ok: false })),
        healthBooking().catch(() => ({ ok: false })),
        healthWS().catch(() => ({ ok: false })),
      ]);

      const status = { auth: a.ok, queue: q.ok, booking: b.ok, ws: w.ok };
      setServiceStatus(status);

      if (!Object.values(status).every(Boolean)) {
        setPhase("error");
        setErrorMsg("Un ou plusieurs services ne répondent pas.");
        return;
      }

      if (!initRes) {
        setPhase("error");
        setErrorMsg("Impossible de charger la configuration du serveur.");
        return;
      }

      setInitData(initRes);

      // 2. Preload company logo from backend
      setPhase("loading-assets");
      const logoUrl = initRes.company.logoUrl
        ? `${API.queue}${initRes.company.logoUrl}?v=boot-logo-20260427`
        : null;

      if (logoUrl) {
        await new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => { setLogoSrc(logoUrl); resolve(); };
          img.onerror = () => { resolve(); }; // continue even if logo fails
          img.src = logoUrl;
        });
      }

      // 3. Small delay so user sees the boot screen, then proceed
      await new Promise((r) => setTimeout(r, 600));
      if (!calledReady.current) {
        calledReady.current = true;
        onReady(initRes);
      }
    } catch {
      setPhase("error");
      setErrorMsg("Erreur de connexion au serveur.");
    }
  };

  useEffect(() => {
    bootstrap();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const companyName = initData?.company.name || "";
  const stationName = initData?.station.name || "";
  const displayLogo = logoSrc || "";

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-slate-50 via-white to-blue-50/40 flex flex-col select-none">
      <style>{`
        @keyframes fadeSlideUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes spinSmooth { to { transform: rotate(360deg); } }
      `}</style>

      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm text-center">
          {displayLogo && (
            <div className="flex items-center justify-center" style={{ animation: 'fadeSlideUp 0.5s ease-out both' }}>
              <img src={displayLogo} alt={companyName || "Company"} className="h-32 w-32 object-contain" />
            </div>
          )}

          {companyName && (
            <div className="mt-5 text-lg font-bold text-slate-800 tracking-tight" style={{ animation: 'fadeSlideUp 0.5s ease-out 0.1s both' }}>
              {companyName}
            </div>
          )}
          {stationName && (
            <div className="text-sm text-slate-400 mt-0.5" style={{ animation: 'fadeSlideUp 0.5s ease-out 0.15s both' }}>
              {stationName}
            </div>
          )}

          {phase !== "error" && (
            <div className="mt-8 flex flex-col items-center gap-4" style={{ animation: 'fadeSlideUp 0.6s ease-out 0.25s both' }}>
              <div className="h-8 w-8 rounded-full border-[3px] border-slate-200 border-t-blue-500" style={{ animation: 'spinSmooth 0.8s linear infinite' }} />
              <div className="text-sm font-medium text-slate-600">
                {phase === "connecting" ? "Connexion au serveur…" : "Chargement des ressources…"}
              </div>
              <div className="flex items-center gap-1.5">
                {['auth', 'queue', 'booking', 'ws'].map((s) => (
                  <div key={s} className={`w-1.5 h-1.5 rounded-full transition-colors duration-300 ${
                    serviceStatus[s] === null ? 'bg-slate-200' : serviceStatus[s] ? 'bg-emerald-400' : 'bg-red-400'
                  }`} />
                ))}
              </div>
            </div>
          )}

          {phase === "error" && (
            <div className="mt-8 rounded-xl border border-red-100 bg-red-50/80 p-5 text-left" style={{ animation: 'fadeSlideUp 0.3s ease-out both' }}>
              <div className="text-sm font-semibold text-red-700 mb-1">Serveur indisponible</div>
              <div className="text-xs text-red-600/80 mb-4">{errorMsg}</div>
              <Button className="w-full h-10 rounded-lg" onClick={bootstrap}>Réessayer</Button>
              <div className="mt-4 flex items-center justify-center gap-3 text-[11px] text-slate-500">
                {[
                  { k: 'auth', l: 'Auth' }, { k: 'queue', l: 'File' },
                  { k: 'booking', l: 'Résa' }, { k: 'ws', l: 'WS' },
                ].map(({ k, l }) => (
                  <span key={k} className="flex items-center gap-1">
                    <span className={`w-1.5 h-1.5 rounded-full ${serviceStatus[k] === null ? 'bg-slate-300' : serviceStatus[k] ? 'bg-emerald-400' : 'bg-red-400'}`} />
                    {l}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="pb-6 flex items-center justify-center" style={{ animation: 'fadeSlideUp 0.5s ease-out 0.35s both' }}>
        <img src="icons/logo.png" alt="Wasla" className="h-8 w-8 object-contain opacity-50" />
      </div>
    </div>
  );
}

