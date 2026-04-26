import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import StationSelectionModal from '@/components/StationSelectionModal';
import StationSetupScreen, { StationConfig } from '@/components/StationSetupScreen';

interface StationContextType {
  selectedStation: StationConfig | null;
  setSelectedStation: (station: StationConfig | null) => void;
  stationConfigs: StationConfig[];
  servedDestinationIds: string[];
  isStationSelected: boolean;
  showStationSelection: boolean;
  setShowStationSelection: (show: boolean) => void;
}

const StationContext = createContext<StationContextType | undefined>(undefined);

export function StationProvider({ children }: { children: React.ReactNode }) {
  const [stationConfigs, setStationConfigs] = useState<StationConfig[]>([]);
  const [selectedStation, setSelectedStation] = useState<StationConfig | null>(null);
  const [showStationSelection, setShowStationSelection] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);

  const servedDestinationIds = useMemo(() => selectedStation?.destinationIds || [], [selectedStation]);

  // Load station configs from localStorage on mount (and migrate legacy config if needed)
  useEffect(() => {
    try {
      const raw = localStorage.getItem('station-configs');
      const selectedId = localStorage.getItem('selected-station-config-id');

      let configs: StationConfig[] = [];
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) configs = parsed;
      }

      // Legacy migration: old "selected-station-id" becomes a single config (best-effort)
      if (configs.length === 0) {
        const legacy = localStorage.getItem('selected-station-id');
        if (legacy) {
          // Very old versions used a few hardcoded ids; map them to destinations.
          const map: Record<string, string[]> = {
            'jammel': ['station-jemmal'],
            'kasra-hlele': ['station-ksar-hlel'],
            'moknin-tboulba': ['station-moknin', 'station-teboulba'],
            'all': ['station-jemmal', 'station-ksar-hlel', 'station-moknin', 'station-teboulba'],
          };
          const destinationIds = map[legacy] || [];
          if (destinationIds.length > 0) {
            const cfg: StationConfig = { id: `cfg_migrated_${Date.now()}`, name: 'Mon poste', destinationIds };
            configs = [cfg];
            localStorage.setItem('station-configs', JSON.stringify(configs));
            localStorage.setItem('selected-station-config-id', cfg.id);
          }
        }
      }

      setStationConfigs(configs);

      if (configs.length === 0) {
        setNeedsSetup(true);
        return;
      }

      const chosen = configs.find(c => c.id === selectedId) || configs[0];
      setSelectedStation(chosen);
      setNeedsSetup(false);
    } catch {
      setNeedsSetup(true);
    }
  }, []);

  // Save selected config id + configs when they change
  useEffect(() => {
    if (selectedStation) {
      try {
        localStorage.setItem('selected-station-config-id', selectedStation.id);
      } catch {}
    } else {
      try {
        localStorage.removeItem('selected-station-config-id');
      } catch {}
    }
  }, [selectedStation]);

  useEffect(() => {
    try {
      localStorage.setItem('station-configs', JSON.stringify(stationConfigs));
    } catch {}
  }, [stationConfigs]);

  const handleStationSelect = (station: StationConfig) => {
    setSelectedStation(station);
    setShowStationSelection(false);
  };

  const handleStationCancel = () => {
    // Don't allow canceling if no station is selected
    if (!selectedStation) {
      return;
    }
    setShowStationSelection(false);
  };

  const value: StationContextType = {
    selectedStation,
    setSelectedStation: (station) => {
      setSelectedStation(station);
      if (station) {
        setShowStationSelection(false);
      }
    },
    stationConfigs,
    servedDestinationIds,
    isStationSelected: !!selectedStation,
    showStationSelection,
    setShowStationSelection: (show) => {
      setShowStationSelection(show);
    }
  };

  return (
    <StationContext.Provider value={value}>
      {needsSetup ? (
        <StationSetupScreen
          onDone={(cfg) => {
            try {
              localStorage.setItem('station-configs', JSON.stringify([cfg]));
              localStorage.setItem('selected-station-config-id', cfg.id);
            } catch {}
            setStationConfigs([cfg]);
            setSelectedStation(cfg);
            setNeedsSetup(false);
            setShowStationSelection(false);
          }}
        />
      ) : (
        <>
          {children}
          {showStationSelection && (
            <StationSelectionModal
              isOpen={showStationSelection}
              stationConfigs={stationConfigs}
              selectedId={selectedStation?.id || null}
              onStationSelect={handleStationSelect}
              onCancel={handleStationCancel}
              onManage={() => setNeedsSetup(true)}
            />
          )}
        </>
      )}
    </StationContext.Provider>
  );
}

export function useStation() {
  const context = useContext(StationContext);
  if (context === undefined) {
    throw new Error('useStation must be used within a StationProvider');
  }
  return context;
}