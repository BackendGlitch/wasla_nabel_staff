import { useState } from "react";
import { login, setAuthToken } from "@/api/client";
import { useCompanyLogoUrl, useCompanyName } from "@/contexts/InitContext";

type Props = { onLoggedIn: (token: string, staffInfo: { firstName: string; lastName: string }) => void };

export default function LoginScreen({ onLoggedIn }: Props) {
  const companyLogo = useCompanyLogoUrl();
  const companyName = useCompanyName();
  const [cin, setCin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const response = await login(cin.trim()) as any;
      const { token, staff } = response.data;
      try {
        localStorage.setItem("authToken", token);
        localStorage.setItem("staffInfo", JSON.stringify({
          firstName: staff.firstName,
          lastName: staff.lastName
        }));
      } catch {}
      setAuthToken(token);
      onLoggedIn(token, { firstName: staff.firstName, lastName: staff.lastName });
  } catch (e: any) {
      setError(e?.message || "Échec de la connexion");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-6 bg-gradient-to-br from-slate-50 via-white to-blue-50/40">
      <div className="w-full max-w-[400px]">
        <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-100 p-8">
          <div className="flex flex-col items-center select-none mb-6">
            <div className="flex items-center justify-center gap-4">
              <img src="icons/logo.png" alt="Wasla" className="w-14 h-14 object-contain" />
              {companyLogo && (
                <>
                  <div className="w-px h-10 bg-slate-200"></div>
                  <img src={companyLogo} alt={companyName} className="w-14 h-14 object-contain" />
                </>
              )}
            </div>
            <h1 className="mt-5 text-xl font-bold text-slate-800 tracking-tight">Wasla</h1>
            {companyName && (
              <p className="text-sm text-slate-400 mt-0.5">{companyName}</p>
            )}
          </div>

          <form className="space-y-4" onSubmit={submit}>
            <div>
              <label className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2 block">CIN</label>
              <input
                value={cin}
                onChange={(e) => setCin(e.target.value)}
                placeholder="Saisissez votre CIN"
                className="w-full h-11 px-4 rounded-xl border border-slate-200 bg-slate-50/50 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-all"
              />
            </div>
            {error && (
              <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-100 text-sm text-red-600">{error}</div>
            )}
            <button
              type="submit"
              disabled={loading || !cin.trim()}
              className="w-full h-11 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-all shadow-sm shadow-blue-600/20 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? "Connexion…" : "Se connecter"}
            </button>
          </form>
          <p className="text-[11px] text-center text-slate-400 mt-5">
            Accès réservé au personnel autorisé.
          </p>
        </div>
      </div>
    </div>
  );
}


