import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

export interface StationConfig {
  id: string;
  name: string;
  destinationIds: string[];
}

interface StationSelectionModalProps {
  isOpen: boolean;
  stationConfigs: StationConfig[];
  selectedId: string | null;
  onStationSelect: (station: StationConfig) => void;
  onCancel?: () => void;
  onManage?: () => void;
}

export default function StationSelectionModal({ 
  isOpen, 
  onStationSelect, 
  onCancel,
  onManage,
  stationConfigs,
  selectedId
}: StationSelectionModalProps) {
  const [selectedStationId, setSelectedStationId] = useState<string>('');

  useEffect(() => {
    setSelectedStationId(selectedId || '');
  }, [selectedId, isOpen]);

  const handleConfirm = () => {
    const selectedStation = stationConfigs.find(station => station.id === selectedStationId);
    if (selectedStation) {
      onStationSelect(selectedStation);
    }
  };

  const handleCancel = () => {
    setSelectedStationId('');
    onCancel?.();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg max-w-md w-full mx-4">
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-semibold">Poste / Stations servies</h2>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => onManage?.()} className="h-9">
                Gérer
              </Button>
              <Button variant="outline" onClick={handleCancel} className="h-9">
                ✕ Fermer
              </Button>
            </div>
          </div>

          <div className="mb-6">
            <p className="text-gray-600 mb-4">
              Sélectionnez la configuration de ce poste :
            </p>
            
            <RadioGroup value={selectedStationId} onValueChange={setSelectedStationId}>
              {stationConfigs.map((station) => (
                <div key={station.id} className="flex items-start space-x-3 p-3 border rounded-lg hover:bg-gray-50">
                  <RadioGroupItem value={station.id} id={station.id} className="mt-1" />
                  <div className="flex-1">
                    <Label htmlFor={station.id} className="font-medium cursor-pointer">
                      {station.name}
                    </Label>
                    <div className="text-xs text-gray-500 mt-1">
                      Destinations: {station.destinationIds.join(', ')}
                    </div>
                  </div>
                </div>
              ))}
            </RadioGroup>
          </div>

          <div className="flex justify-end space-x-3">
            <Button variant="outline" onClick={handleCancel}>
              Annuler
            </Button>
            <Button 
              onClick={handleConfirm}
              disabled={!selectedStationId}
            >
              Confirmer
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}