import { useEffect, useMemo, useState } from "react";
import { getAllDestinations } from "@/api/client";
import { useCompanyLogoUrl, useCompanyName } from "@/contexts/InitContext";

export type Destination = { id: string; name: string; basePrice: number; isActive: boolean };

export type StationConfig = {
  id: string;
  name: string;
  destinationIds: string[];
};

type Props = {
  onDone: (config: StationConfig) => void;
};

function newId() {
  return `cfg_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

export default function StationSetupScreen({ onDone }: Props) {
  const companyLogo = useCompanyLogoUrl();
  const companyName = useCompanyName();
  const [loading, setLoading] = useState(true);
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("Mon poste");
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await getAllDestinations();
        const list = (r.data || []).filter((d: any) => d.isActive !== false);
        if (!cancelled) {
          setDestinations(list);
          const next: Record<string, boolean> = {};
          for (const d of list) next[d.id] = true; // default: select all active
          setSelected(next);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Impossible de charger les destinations.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedIds = useMemo(
    () => Object.entries(selected).filter(([, v]) => v).map(([k]) => k),
    [selected]
  );

  const canConfirm = !loading && selectedIds.length > 0 && name.trim().length > 0;

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-slate-50 via-white to-blue-50/40 flex items-center justify-center p-6">
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-100 overflow-hidden">
        <div className="px-7 py-6 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-slate-800 tracking-tight">Configuration initiale</h1>
            <p className="text-sm text-slate-400 mt-0.5">Choisissez les destinations que ce poste va servir.</p>
          </div>
          <div className="flex items-center gap-3 select-none">
            <img src="icons/logo.png" alt="Wasla" className="h-9 w-9 object-contain" />
            {companyLogo && (
              <>
                <div className="w-px h-7 bg-slate-200"></div>
                <img src={companyLogo} alt={companyName} className="h-9 w-9 object-contain" />
              </>
            )}
          </div>
        </div>

        <div className="px-7 py-6 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-1 space-y-4">
            <div>
              <label className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2 block">Nom du poste</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Guichet 1"
                className="w-full h-10 px-3 rounded-lg border border-slate-200 bg-slate-50/50 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-all"
              />
            </div>
            <div className="px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-100">
              <span className="text-xs text-slate-500">Sélection: </span>
              <span className="text-xs font-bold text-slate-700">{selectedIds.length}</span>
              <span className="text-xs text-slate-500"> destination(s)</span>
            </div>
          </div>

          <div className="md:col-span-2">
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2 block">Destinations actives</label>

            {error && (
              <div className="mb-3 p-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-600">{error}</div>
            )}

            {loading ? (
              <div className="p-8 text-sm text-slate-400 text-center">Chargement…</div>
            ) : (
              <div className="border border-slate-200 rounded-xl bg-white overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100 bg-slate-50/50">
                  <button onClick={() => { const n: Record<string, boolean> = {}; for (const d of destinations) n[d.id] = true; setSelected(n); }}
                    className="text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors">Tout sélectionner</button>
                  <button onClick={() => { const n: Record<string, boolean> = {}; for (const d of destinations) n[d.id] = false; setSelected(n); }}
                    className="text-xs font-medium text-slate-500 hover:text-slate-700 transition-colors">Tout désélectionner</button>
                </div>

                <div className="max-h-[360px] overflow-y-auto scrollbar-thin divide-y divide-slate-100">
                  {destinations.map((d) => (
                    <label key={d.id} className="flex items-center gap-3 px-4 py-3 hover:bg-blue-50/30 cursor-pointer transition-colors">
                      <input
                        type="checkbox"
                        checked={!!selected[d.id]}
                        onChange={(e) => setSelected((prev) => ({ ...prev, [d.id]: e.target.checked }))}
                        className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500/20"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-slate-700 truncate">{d.name}</div>
                      </div>
                      <div className="text-xs font-semibold text-slate-600 tabular-nums">{Number(d.basePrice || 0).toFixed(2)} TND</div>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="px-7 py-4 border-t border-slate-100 flex items-center justify-end">
          <button
            onClick={() => onDone({ id: newId(), name: name.trim(), destinationIds: selectedIds })}
            disabled={!canConfirm}
            className="h-10 px-6 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-all shadow-sm shadow-blue-600/20 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Terminer
          </button>
        </div>
      </div>
    </div>
  );
}

