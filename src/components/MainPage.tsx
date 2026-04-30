import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  cancelOneBookingByQueueEntry,
  listQueue,
  listQueueSummaries,
  logout as apiLogout,
  setOnAuthLogout,
} from "@/api/client";
import { printerService } from "@/services/printerService";
import { useCompanyLogoUrl, useCompanyName } from "@/contexts/InitContext";
import PrinterStatusDisplay from "@/components/PrinterStatusDisplay";
import LatencyDisplay from "@/components/LatencyDisplay";
import UpdateStatus from "@/components/UpdateStatus";
import PrintQueueIndicator from "@/components/PrintQueueIndicator";
import UsbPrinterStatus from "@/kiosk/components/UsbPrinterStatus";
import { useStation } from "@/contexts/StationContext";
import { isPosMode } from "@/services/machineMode";
import {
  DndContext,
  closestCenter,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { QueueEntry, Summary } from "@/kiosk/types";
import { useNotifications } from "@/kiosk/state/useNotifications";
import { useStationData } from "@/kiosk/state/useStationData";
import { usePosWorkflow } from "@/kiosk/state/usePosWorkflow";

// Re-export for backwards compatibility with sibling modules that may import
// these types from MainPage. Step 6 will retire them when the in-file modal
// components are extracted to `src/kiosk/modals/`.
export type { Summary, QueueEntry };

// eslint-disable-next-line @typescript-eslint/no-unused-vars
// Vehicle Trips Count Modal Component (unused; staff app removed this feature)
function VehicleTripsCountModal({
  isOpen,
  onClose,
  query,
  onQueryChange,
  count,
  loading,
  error,
  onSearch,
  suggestions,
  suggestionsLoading,
  onSelectVehicle
}: {
  isOpen: boolean;
  onClose: () => void;
  query: string;
  onQueryChange: (query: string) => void;
  count: number | null;
  loading: boolean;
  error: string | null;
  onSearch: () => void;
  suggestions: any[];
  suggestionsLoading: boolean;
  onSelectVehicle: (vehicle: any) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div 
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-orange-600 to-orange-700 text-white p-6 rounded-t-2xl">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-2xl font-bold">🚗 Nombre de Trajets</h2>
              <p className="text-orange-100 mt-1">Recherchez le nombre de trajets d'un véhicule aujourd'hui</p>
            </div>
            <button
              onClick={onClose}
              className="text-orange-200 hover:text-white text-3xl transition-colors"
            >
              ×
            </button>
          </div>
        </div>

        <div className="p-6">
          {/* Search Input */}
          <div className="mb-6">
            <label className="block text-lg font-semibold text-gray-800 mb-3">
              Immatriculation du véhicule
            </label>
            <div className="relative">
              <input
                ref={inputRef}
                type="text"
                placeholder="Ex: 130 TUN 2221"
                value={query}
                onChange={(e) => onQueryChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    onSearch();
                  }
                }}
                className="w-full px-4 py-3 text-lg border-2 border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-all"
                autoFocus
              />
            </div>
            
            {/* Vehicle Suggestions */}
            {query && suggestions.length > 0 && (
              <div className="mt-3 max-h-48 overflow-y-auto border border-gray-200 rounded-lg bg-white shadow-sm">
                <div className="p-2 text-xs text-gray-500 border-b border-gray-100">
                  Suggestions ({suggestions.length})
                </div>
                {suggestions.map((vehicle) => {
                  if (!vehicle || !vehicle.licensePlate) return null;
                  
                  return (
                    <div
                      key={vehicle.id}
                      className="p-3 hover:bg-orange-50 cursor-pointer border-b border-gray-100 last:border-b-0 transition-colors"
                      onClick={() => onSelectVehicle(vehicle)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="font-medium text-gray-800">{vehicle.licensePlate}</div>
                          {vehicle.capacity && (
                            <div className="text-sm text-gray-500">Capacité: {vehicle.capacity} sièges</div>
                          )}
                        </div>
                        <div className="text-orange-500 text-sm">Cliquer pour sélectionner</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            
            {suggestionsLoading && (
              <div className="mt-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
                <div className="text-sm text-gray-600 flex items-center">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-orange-500 mr-2"></div>
                  Recherche de véhicules...
                </div>
              </div>
            )}
            
            {/* Error Message */}
            {error && (
              <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                <div className="text-sm text-red-600 flex items-center">
                  <span className="mr-2">!</span>
                  {error}
                </div>
              </div>
            )}
          </div>

          {/* Search Button */}
          <Button
            onClick={onSearch}
            disabled={loading || !query.trim()}
            className="w-full bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white py-3 rounded-xl shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <span className="flex items-center justify-center">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                Recherche...
              </span>
            ) : (
              'Rechercher'
            )}
          </Button>

          {/* Results */}
          {count !== null && (
            <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-xl">
              <div className="text-center">
                <div className="text-4xl mb-2">🚗</div>
                <div className="text-lg font-semibold text-green-800 mb-1">
                  Véhicule: {query}
                </div>
                <div className="text-2xl font-bold text-green-600 mb-2">
                  {count} trajet{count > 1 ? 's' : ''}
                </div>
                <div className="text-sm text-green-600">
                  effectué{count > 1 ? 's' : ''} aujourd'hui
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Add Vehicle Modal Component
function AddVehicleModal({
  isOpen,
  onClose,
  searchQuery,
  onSearchChange,
  searchResults,
  loadingSearch,
  onSelectVehicle,
  selectedVehicle,
  authorizedStations,
  loadingStations,
  onConfirmAdd,
  queue,
  searchError,
}: {
  isOpen: boolean;
  onClose: () => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  searchResults: any[];
  loadingSearch: boolean;
  onSelectVehicle: (vehicle: any) => void;
  selectedVehicle: any;
  authorizedStations: any[];
  loadingStations: boolean;
  onConfirmAdd: (station: any) => void;
  queue: QueueEntry[];
  searchError: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Robust focus management - ensure input is always focusable
  useEffect(() => {
    if (isOpen && inputRef.current) {
      // Small delay to ensure modal is fully rendered
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.disabled = false;
          inputRef.current.readOnly = false;
        }
      }, 100);
    }
  }, [isOpen]);

  // Additional effect to ensure input stays enabled
  useEffect(() => {
    if (isOpen && inputRef.current) {
      const input = inputRef.current;
      input.disabled = false;
      input.readOnly = false;
    }
  }, [isOpen, searchQuery, loadingSearch]);

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div 
        className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-5 py-4">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Ajouter un véhicule</h2>
              <p className="text-xs text-gray-500 mt-0.5">Recherchez et sélectionnez un véhicule pour l'ajouter à la file</p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="p-5 overflow-y-auto flex-1">
          {/* Search Section */}
          <div className="mb-5">
            <label className="block text-xs font-medium text-gray-700 mb-1.5">
              Rechercher par immatriculation
            </label>
            <div className="relative">
              <input
                ref={inputRef}
                type="text"
                placeholder="Tapez l'immatriculation du véhicule..."
                value={searchQuery}
                onChange={(e) => {
                  e.target.disabled = false;
                  e.target.readOnly = false;
                  onSearchChange(e.target.value);
                }}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                autoFocus
                disabled={false}
                readOnly={false}
              />
              {loadingSearch && (
                <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-600 border-t-transparent"></div>
                </div>
              )}
            </div>
            
            {/* Search Error */}
            {searchError && (
              <div className="mt-2 p-2.5 bg-red-50 border border-red-200 rounded-md">
                <div className="text-xs text-red-700 flex items-center gap-1.5">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {searchError}
                </div>
              </div>
            )}
          </div>

          {/* Search Results */}
          {searchQuery && (
            <div className="mb-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                  Résultats ({searchResults.length})
                </h3>
                {searchResults.length > 0 && (
                  <span className="text-xs text-gray-500">Cliquez pour sélectionner</span>
                )}
              </div>
              
              {loadingSearch ? (
                <div className="text-center py-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-2 border-blue-600 border-t-transparent mx-auto mb-2"></div>
                  <div className="text-xs text-gray-500">Recherche en cours...</div>
                </div>
              ) : searchResults.length === 0 ? (
                <div className="text-center py-8 bg-gray-50 rounded-md border border-gray-200">
                  <div className="text-4xl mb-2 opacity-30">🚗</div>
                  <div className="text-sm font-medium text-gray-600 mb-1">Aucun véhicule trouvé</div>
                  <div className="text-xs text-gray-500">Vérifiez l'orthographe de l'immatriculation</div>
                </div>
              ) : (
                <div className="space-y-2">
                  {searchResults.map((vehicle) => {
                    if (!vehicle || !vehicle.id || !vehicle.licensePlate) {
                      return null;
                    }
                    
                    const queuedEntry = queue.find(entry => entry.vehicleId === vehicle.id);
                    
                    return (
                      <div
                        key={vehicle.id}
                        className={`p-3 rounded-md border transition-all duration-150 cursor-pointer ${
                          queuedEntry 
                            ? 'bg-gray-50 border-gray-200 cursor-not-allowed opacity-60' 
                            : 'bg-white border-gray-200 hover:border-blue-300 hover:bg-blue-50/30'
                        }`}
                        onClick={() => !queuedEntry && onSelectVehicle(vehicle)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1.5">
                              <div className="text-sm font-semibold text-gray-900">{vehicle.licensePlate}</div>
                              <div className="flex gap-1.5">
                                <span className="px-1.5 py-0.5 text-xs bg-blue-100 text-blue-700 rounded font-medium">
                                  {vehicle.capacity} sièges
                                </span>
                                {vehicle.isActive && (
                                  <span className="px-1.5 py-0.5 text-xs bg-emerald-100 text-emerald-700 rounded font-medium">
                                    Actif
                                  </span>
                                )}
                                {vehicle.isAvailable && (
                                  <span className="px-1.5 py-0.5 text-xs bg-emerald-50 text-emerald-600 rounded font-medium border border-emerald-200">
                                    Disponible
                                  </span>
                                )}
                              </div>
                            </div>
                            
                            {queuedEntry ? (
                              <div className="text-xs text-red-600 font-medium flex items-center gap-1">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                Déjà en file à la position {queuedEntry.queuePosition}
                              </div>
                            ) : (
                              <div className="text-xs text-gray-500">
                                Cliquez pour sélectionner
                              </div>
                            )}
                          </div>
                          
                          {!queuedEntry && (
                            <svg className="w-4 h-4 text-blue-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Selected Vehicle Info */}
          {selectedVehicle && (
            <div className="mb-5 p-3 bg-blue-50 border border-blue-200 rounded-md">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-blue-100 rounded flex items-center justify-center flex-shrink-0">
                  <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-blue-600 font-medium mb-0.5">Véhicule sélectionné</div>
                  <div className="text-sm font-semibold text-gray-900">{selectedVehicle.licensePlate}</div>
                  <div className="text-xs text-gray-600">Capacité: {selectedVehicle.capacity} sièges</div>
                </div>
              </div>
            </div>
          )}

          {/* Authorized Stations */}
          {selectedVehicle && (
            <div className="mb-5">
              <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-3">Choisir la destination</h3>
              
              {loadingStations ? (
                <div className="text-center py-6">
                  <div className="animate-spin rounded-full h-5 w-5 border-2 border-blue-600 border-t-transparent mx-auto mb-2"></div>
                  <div className="text-xs text-gray-500">Chargement des destinations...</div>
                </div>
              ) : authorizedStations.length === 0 ? (
                <div className="text-center py-6 bg-gray-50 rounded-md border border-gray-200">
                  <div className="text-3xl mb-2 opacity-30">⚠️</div>
                  <div className="text-xs text-gray-600 font-medium">Aucune destination autorisée pour ce véhicule</div>
                </div>
              ) : (
                <div className="space-y-2">
                  {authorizedStations.map((station) => (
                    <button
                      key={station.id}
                      onClick={() => onConfirmAdd(station)}
                      className="w-full p-3 text-left bg-white border border-gray-200 rounded-md hover:border-blue-300 hover:bg-blue-50/30 transition-all duration-150"
                    >
                      <div className="flex justify-between items-center">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-gray-900">{station.stationName}</div>
                          <div className="text-xs text-gray-600 mt-0.5 flex items-center gap-2">
                            <span>Priorité: {station.priority}</span>
                            {station.isDefault && (
                              <span className="px-1.5 py-0.5 text-xs bg-blue-100 text-blue-700 rounded font-medium">
                                Par défaut
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0 ml-3">
                          <div className="text-xs text-gray-500 mb-1">ID: {station.stationId}</div>
                          <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Sortable Queue Item Component
function SortableQueueItem({ 
  entry, 
  index, 
  totalItems,
  onMoveUp, 
  onMoveDown,
  onSelectForBooking,
  isSelectedForBooking
}: { 
  entry: QueueEntry; 
  index: number; 
  totalItems: number;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onSelectForBooking: () => void;
  isSelectedForBooking: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: entry.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  // Calculate the actual position based on index (0-based) + 1
  const actualPosition = index + 1;

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={onSelectForBooking}
      className={`px-4 py-3 transition-all cursor-pointer border-l-[3px] ${
        isSelectedForBooking ? 'bg-amber-50/60 border-l-amber-400' : index === 0 ? 'border-l-blue-500 bg-blue-50/30' : 'border-l-transparent hover:bg-slate-50/60'
      } ${isDragging ? 'shadow-lg opacity-75 bg-white' : ''} border-b border-slate-100`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className={`flex items-center justify-center w-7 h-7 rounded-lg font-bold text-xs flex-shrink-0 ${
            index === 0 ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'
          }`}>
            {actualPosition}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm text-slate-800 truncate font-mono">{entry.licensePlate}</span>
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              {index === 0 ? 'Prochain départ' : `Position ${actualPosition}`}
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-2.5 flex-shrink-0">
          <div className="text-right">
            <div className="flex items-baseline gap-0.5">
              <span className={`text-sm font-bold ${entry.availableSeats === 0 ? 'text-emerald-500' : 'text-blue-600'}`}>{entry.availableSeats}</span>
              <span className="text-[10px] text-slate-300">/</span>
              <span className="text-[10px] text-slate-500">{entry.totalSeats}</span>
            </div>
            <div className="text-[10px] text-slate-400">
              {entry.bookedSeats && entry.bookedSeats > 0 ? `${entry.bookedSeats} rés.` : 'dispo'}
            </div>
          </div>

          <div className="flex items-center gap-0.5">
            <div className="flex flex-col">
              <button onClick={(e) => { e.stopPropagation(); onMoveUp(); }} disabled={index === 0}
                className={`w-5 h-4 flex items-center justify-center rounded-sm transition-colors ${index === 0 ? 'text-slate-200' : 'text-slate-400 hover:text-blue-600 hover:bg-blue-50'}`}>
                <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2.5} d="M5 15l7-7 7 7" /></svg>
              </button>
              <button onClick={(e) => { e.stopPropagation(); onMoveDown(); }} disabled={index === totalItems - 1}
                className={`w-5 h-4 flex items-center justify-center rounded-sm transition-colors ${index === totalItems - 1 ? 'text-slate-200' : 'text-slate-400 hover:text-blue-600 hover:bg-blue-50'}`}>
                <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg>
              </button>
            </div>
            <div {...attributes} {...listeners} onClick={(e) => e.stopPropagation()}
              className="cursor-grab active:cursor-grabbing p-1 rounded-lg hover:bg-slate-100 transition-colors text-slate-300 hover:text-slate-500">
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 6a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm0 8a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm0 8a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm8-16a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm0 8a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm0 8a2 2 0 1 1 0-4 2 2 0 0 1 0 4z"/></svg>
            </div>
          </div>
        </div>
      </div>
      
      {isSelectedForBooking && (
        <div className="mt-2 pt-2 border-t border-amber-200/50">
          <div className="text-[11px] text-amber-600 font-medium flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 bg-amber-400 rounded-full"></span>
            Sélectionné pour réservation
          </div>
        </div>
      )}
    </div>
  );
}

export default function MainPage() {
  // Reference legacy modal component preserved for future cleanup steps so
  // tsc does not flag it as unused. Step 6 will delete it.
  void VehicleTripsCountModal;

  const { selectedStation, servedDestinationIds, setShowStationSelection } = useStation();
  const companyLogo = useCompanyLogoUrl();
  const companyName = useCompanyName();
  const posMode = isPosMode();

  const { notification, showNotification } = useNotifications();

  const station = useStationData({
    selectedStation,
    servedDestinationIds,
    showNotification,
  });

  const workflow = usePosWorkflow({
    station,
    showNotification,
  });

  // Destructure hook outputs into local names so the JSX below stays
  // identical to the legacy desktop layout. Step 2 will start consuming the
  // hook return values directly inside dedicated kiosk screens.
  const {
    summaries,
    allDestinations,
    selected,
    setSelected,
    queue,
    setQueue,
    setSummaries,
    loading,
    setLoading,
    reordering,
    reorderSuccess,
    todayTicketsByDestination,
    wsConnected,
    wsLatency,
    refreshQueueAndSummaries,
  } = station;

  const {
    staffInfo,
    sensors,
    selectedSeats,
    setSelectedSeats,
    bookingLoading,
    setBookingLoading,
    selectedVehicleForBooking,
    setSelectedVehicleForBooking,
    isSelectedVehicleStillInQueue,
    handleSeatCountSelect,
    handleConfirmBooking,
    saveSelectedVehicle,
    handleDragEnd,
    handleMoveUp,
    handleMoveDown,
    addVehicleModalOpen,
    setAddVehicleModalOpen,
    vehicleSearchQuery,
    searchResults,
    setSearchResults,
    loadingSearch,
    setLoadingSearch,
    selectedVehicle,
    setSelectedVehicle,
    vehicleAuthorizedStations,
    loadingVehicleStations,
    searchError,
    setSearchError,
    setVehicleSearchQuery,
    handleSearchInputChange,
    handleSelectVehicle,
    handleConfirmAddVehicle,
    isGhostMode,
    selectedGhostDestination,
    lastGhostBookingForReprint,
    ghostPrintFailed,
    handleEnterGhostMode,
    handleExitGhostMode,
    handleGhostDestinationSelect,
    handleGhostBooking,
    handleReprintLastGhostTicket,
  } = workflow;

  // Push server-provided branding into the printer service singleton so that
  // every ticket renders with the correct station identity.
  useEffect(() => {
    if (companyLogo || companyName) {
      printerService.setBranding(companyName, companyLogo);
    }
  }, [companyLogo, companyName]);

  // Surface 401-driven logouts as a toast and bounce the user back to the
  // login screen by reloading. Local credentials are wiped first so the
  // reload lands on the clean login flow.
  useEffect(() => {
    setOnAuthLogout((reason) => {
      const message = reason || "Session expirée, veuillez vous reconnecter.";
      showNotification(message, "error");

      setTimeout(() => {
        try {
          window.localStorage.removeItem("authToken");
          window.localStorage.removeItem("staffInfo");
          window.localStorage.removeItem("selectedVehicleForBooking");
        } catch {
          // localStorage may be unavailable; ignore — reload still rescues us.
        }

        window.location.reload();
      }, 500);
    });

    return () => {
      setOnAuthLogout(null);
    };
    // showNotification is stable across renders; legacy effect had an empty
    // dep array so we preserve that behavior here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard shortcuts: F6 (open add vehicle), ESC (close add vehicle),
  // AZERTY letters to select destinations, Numpad 1-9 to set seat count, Space to confirm booking
  useEffect(() => {
    const isTypingTarget = (el: EventTarget | null) => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName.toLowerCase();
      const editable = el.getAttribute("contenteditable");
      return tag === "input" || tag === "textarea" || tag === "select" || editable === "" || editable === "true";
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;

      if (e.key === "F6") {
        e.preventDefault();
        setAddVehicleModalOpen(true);
        return;
      }

      if (e.key === "Escape") {
        if (addVehicleModalOpen) {
          e.preventDefault();
          setAddVehicleModalOpen(false);
          return;
        }
      }

      const azertyMap: Record<string, number> = { a: 0, z: 1, e: 2, r: 3, t: 4, y: 5 };
      const keyLower = e.key.toLowerCase();
      if (azertyMap[keyLower] !== undefined) {
        const idx = azertyMap[keyLower];
        if (isGhostMode) {
          if (allDestinations[idx]) {
            e.preventDefault();
            handleGhostDestinationSelect(allDestinations[idx]);
          }
        } else {
          if (summaries[idx]) {
            e.preventDefault();
            const s = summaries[idx];
            setSelected(s);
            setQueue([]);
            setSelectedVehicleForBooking(null);
            setSelectedSeats([]);
            saveSelectedVehicle(null);
            setLoading(false);
          }
        }
        return;
      }

      if (e.code && e.code.startsWith("Numpad")) {
        const digit = Number(e.key);
        if (!Number.isNaN(digit) && digit > 0 && digit < 10) {
          if (isGhostMode && selectedGhostDestination) {
            e.preventDefault();
            const seatCount = Math.min(digit, 8);
            setSelectedSeats(Array.from({ length: seatCount }, (_, i) => i + 1));
          } else if (selected) {
            e.preventDefault();
            const available = selectedVehicleForBooking ? (selectedVehicleForBooking.availableSeats ?? 0) : (selected.availableSeats ?? 0);
            const seatCount = Math.min(digit, Math.max(0, available));
            if (seatCount > 0) {
              setSelectedSeats(Array.from({ length: seatCount }, (_, i) => i + 1));
            }
          }
        }
        return;
      }

      if (e.code === "Space" || e.key === " ") {
        if (bookingLoading) {
          e.preventDefault();
          return;
        }
        if (isGhostMode && selectedGhostDestination && selectedSeats.length > 0) {
          e.preventDefault();
          handleGhostBooking();
        } else if (selected && selectedSeats.length > 0) {
          e.preventDefault();
          handleConfirmBooking();
        }
        return;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
    // Mirrors the legacy dep list exactly to avoid behavioral drift.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addVehicleModalOpen, summaries, selected, selectedVehicleForBooking, selectedSeats, isGhostMode, selectedGhostDestination, bookingLoading, allDestinations]);

  const handleLogout = async () => {
    try {
      await apiLogout();
    } catch {
      // Even if the API fails, we still want to log out locally.
      try {
        window.localStorage.removeItem("authToken");
        window.localStorage.removeItem("staffInfo");
        window.localStorage.removeItem("selectedVehicleForBooking");
      } catch {
        // ignore — reload still rescues us
      }
      window.location.reload();
    }
  };

  return (
    <div className={`w-full h-screen overflow-hidden flex flex-col transition-colors ${isGhostMode ? 'bg-violet-50/30' : 'bg-[hsl(220,20%,98%)]'}`}>
      {/* Header */}
      <div className={`border-b ${isGhostMode ? 'bg-violet-50/60 border-violet-200/60' : 'bg-white border-slate-200/80'} transition-colors`}>
        <div className="px-5 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="icons/logo.png" alt="Wasla" className="h-7 w-7 object-contain" />
            {companyLogo && (
              <>
                <div className="w-px h-5 bg-slate-200"></div>
                <img src={companyLogo} alt={companyName} className="h-7 w-7 object-contain" />
              </>
            )}
            <div className="w-px h-5 bg-slate-200 ml-1"></div>
            <h1 className="text-sm font-semibold text-slate-800">{isGhostMode ? 'Mode Fantôme' : 'Files de station'}</h1>
            {selectedStation && !isGhostMode && (
              <span className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded-md text-[11px] font-medium">
                {selectedStation.name}
              </span>
            )}
            {isGhostMode && (
              <span className="px-2 py-0.5 bg-violet-100 text-violet-700 rounded-md text-[11px] font-semibold animate-pulse">
                FANTÔME
              </span>
            )}
          </div>
          
          <div className="flex items-center gap-1.5">
            <button onClick={() => setShowStationSelection(true)}
              className="h-8 px-3 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors">
              Station
            </button>
            {posMode ? (
              <UsbPrinterStatus />
            ) : (
              <>
                <PrinterStatusDisplay onConfigUpdate={() => {}} />
                <PrintQueueIndicator />
                <LatencyDisplay connected={wsConnected} latency={wsLatency} compact={true} />
              </>
            )}
            <UpdateStatus className="flex items-center gap-2" />
            <button onClick={async () => { try { await refreshQueueAndSummaries(); showNotification('Données mises à jour.', 'success'); } catch { showNotification("Échec de l'actualisation.", 'error'); } }}
              className="h-8 px-3 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors flex items-center gap-1.5">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
              Rafraîchir
            </button>
            {!isGhostMode && (
              <button onClick={() => setAddVehicleModalOpen(true)}
                className="h-8 px-3.5 rounded-lg bg-blue-600 text-xs font-medium text-white hover:bg-blue-700 transition-colors shadow-sm shadow-blue-600/20 flex items-center gap-1.5">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" d="M12 5v14m-7-7h14"/></svg>
                Ajouter
              </button>
            )}
            {staffInfo && (
              <>
                <div className="h-5 w-px bg-slate-200 mx-1"></div>
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center text-[10px] font-bold">
                    {(staffInfo.firstName?.[0] || '').toUpperCase()}{(staffInfo.lastName?.[0] || '').toUpperCase()}
                  </div>
                  <span className="text-xs font-medium text-slate-700">{staffInfo.firstName}</span>
                </div>
                <button onClick={handleLogout} className="h-8 px-2.5 rounded-lg text-xs font-medium text-slate-500 hover:text-red-600 hover:bg-red-50 transition-colors">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/></svg>
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar - Queue List (hidden in ghost mode) */}
        {!isGhostMode && (
          <div className="w-1/3 bg-white border-r border-slate-200/80 flex flex-col">
            <div className="px-4 py-3 border-b border-slate-100">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">File des véhicules</h2>
                  {selected && (
                    <div className="text-xs font-medium text-blue-600 mt-0.5">{selected.destinationName}</div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {reordering && <div className="w-3 h-3 border-2 border-slate-200 border-t-blue-500 rounded-full animate-spin" />}
                  {reorderSuccess && <span className="text-[11px] text-emerald-500 font-medium">Réorganisé</span>}
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-thin">
              {loading ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <div className="w-6 h-6 border-2 border-slate-200 border-t-blue-500 rounded-full animate-spin mx-auto mb-2"></div>
                    <div className="text-xs text-slate-400">Chargement…</div>
                  </div>
                </div>
              ) : queue.length === 0 ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center px-6">
                    <svg className="w-10 h-10 text-slate-200 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5"><path strokeLinecap="round" d="M5 17h2m10 0h2M5 11l1.5-4.5A2 2 0 018.4 5h7.2a2 2 0 011.9 1.5L19 11M3 17h18v-4a2 2 0 00-2-2H5a2 2 0 00-2 2z"/></svg>
                    <div className="text-sm font-medium text-slate-500 mb-1">
                      {selected ? `File ${selected.destinationName}` : 'Aucune destination'}
                    </div>
                    <div className="text-xs text-slate-400">
                      {selected ? 'Aucun véhicule dans la file' : 'Sélectionnez une destination'}
                    </div>
                  </div>
                </div>
              ) : (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext items={(queue || []).map(item => item.id)} strategy={verticalListSortingStrategy}>
                    <div className="divide-y divide-gray-100">
                      {(queue || []).map((entry, index) => (
                        <SortableQueueItem 
                          key={entry.id} 
                          entry={entry} 
                          index={index}
                          totalItems={(queue || []).length}
                          onMoveUp={() => handleMoveUp(index)}
                          onMoveDown={() => handleMoveDown(index)}
                          onSelectForBooking={() => {
                            if (selectedVehicleForBooking?.id === entry.id) {
                              setSelectedVehicleForBooking(null);
                              saveSelectedVehicle(null);
                              setSelectedSeats([]);
                            } else {
                              setSelectedVehicleForBooking(entry);
                              saveSelectedVehicle(entry);
                              setSelectedSeats([1]);
                            }
                          }}
                          isSelectedForBooking={selectedVehicleForBooking?.id === entry.id}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              )}
            </div>
          </div>
        )}

        {/* Right Side (full width in ghost mode) */}
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* ── Ghost Mode: dedicated full-width layout ── */}
          {isGhostMode ? (
            <>
              <div className="flex-1 overflow-y-auto scrollbar-thin">
                <div className="max-w-4xl mx-auto px-6 py-8">
                  {/* Ghost header */}
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center">
                        <svg className="w-5 h-5 text-violet-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z"/></svg>
                      </div>
                      <div>
                        <h2 className="text-lg font-bold text-violet-800 tracking-tight">Mode Fantôme</h2>
                        <p className="text-xs text-violet-500">Réservation directe sans véhicule</p>
                      </div>
                    </div>
                    <button onClick={handleExitGhostMode}
                      className="h-9 px-4 rounded-xl bg-red-500 text-sm font-medium text-white hover:bg-red-600 transition-colors shadow-sm flex items-center gap-2">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" d="M6 18L18 6M6 6l12 12"/></svg>
                      Quitter
                    </button>
                  </div>

                  {/* Destination grid -- larger cards in ghost mode */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 mb-8">
                    {allDestinations.map((dest) => {
                      const isSelected = selectedGhostDestination?.destinationId === dest.id;
     
                      return (
                        <div key={dest.id} onClick={() => handleGhostDestinationSelect(dest)}
                          className={`relative p-5 rounded-2xl border-2 text-center cursor-pointer transition-all ${
                            isSelected ? "bg-violet-50 border-violet-400 shadow-md shadow-violet-100" : "bg-white border-slate-200 hover:border-violet-300 hover:shadow-sm"
                          }`}>
                       
                          <h3 className={`text-sm font-semibold mb-2 ${isSelected ? 'text-violet-700' : 'text-slate-700'}`}>{dest.name}</h3>
                          <p className={`text-2xl font-bold ${isSelected ? 'text-violet-600' : 'text-slate-800'}`}>{dest.basePrice.toFixed(2)}</p>
                          <span className="text-xs text-slate-400">TND</span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Inline booking for ghost mode */}
                  {selectedGhostDestination && (
                    <div className="bg-violet-50/40 border border-violet-200/60 rounded-2xl p-6">
                      <div className="text-center mb-5">
                        <h3 className="text-base font-bold text-violet-800">{selectedGhostDestination.destinationName}</h3>
                        <p className="text-xs text-violet-500 mt-0.5">Sélectionnez le nombre de sièges</p>
                      </div>
                      <div className="grid grid-cols-8 gap-2 max-w-lg mx-auto mb-6">
                        {[1, 2, 3, 4, 5, 6, 7, 8].map((seatCount) => {
                          const isSelected = selectedSeats.length === seatCount;
                          return (
                            <button key={seatCount} onClick={() => handleSeatCountSelect(seatCount)}
                              className={`h-14 rounded-xl border-2 transition-all text-lg font-bold ${
                                isSelected
                                  ? 'bg-violet-600 border-violet-600 text-white shadow-lg shadow-violet-600/30 scale-105'
                                  : 'bg-white border-slate-200 text-violet-700 hover:border-violet-300 hover:bg-violet-50/50'
                              }`}>
                              {seatCount}
                            </button>
                          );
                        })}
                      </div>
                      <div className="flex items-center justify-center gap-6">
                        <div className="text-center">
                          <div className="text-2xl font-bold text-violet-800 tabular-nums">
                            {(
                              selectedSeats.length *
                              (
                                (selectedGhostDestination.basePrice || 0) +
                                (selectedGhostDestination.serviceFee ?? 0.2)
                              )
                            ).toFixed(2)}
                          </div>
                          <div className="text-xs text-violet-500 mt-0.5">TND total</div>
                        </div>
                        <button
                          onClick={handleGhostBooking}
                          disabled={bookingLoading || selectedSeats.length === 0}
                          className="h-12 px-8 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 transition-all shadow-sm shadow-violet-600/25 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2">
                          {bookingLoading ? (
                            <><div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin"></div>Création…</>
                          ) : (
                            <>
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z"/></svg>
                              Créer {selectedSeats.length} siège{selectedSeats.length === 1 ? '' : 's'}
                            </>
                          )}
                        </button>
                      </div>
                      {lastGhostBookingForReprint && ghostPrintFailed && (
                        <div className="mt-4 text-center">
                          <button onClick={handleReprintLastGhostTicket} disabled={bookingLoading}
                            className="h-9 px-5 rounded-lg border border-violet-200 text-xs font-medium text-violet-700 hover:bg-violet-50 transition-colors disabled:opacity-40">
                            Réimprimer #{lastGhostBookingForReprint.seatNumber}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Ghost mode bottom bar */}
              <div className="border-t border-violet-100 bg-violet-50/30 px-5 py-2.5">
                <div className="flex justify-end gap-1.5" />
              </div>
            </>
          ) : (
            <>
              {/* ── Normal Mode ── */}
              <div className="flex-1 overflow-y-auto scrollbar-thin p-5">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-base font-bold tracking-tight text-slate-800">Destinations</h2>
                      <p className="text-xs mt-0.5 text-slate-400">Sélectionnez une destination</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2.5">
                    {(summaries || []).map((s) => {
                      const isSelected = selected?.destinationId === s.destinationId;
                      const bookedCountForCard =
                        todayTicketsByDestination[s.destinationId]?.regularCountToday ?? 0;
                      return (
                        <div key={s.destinationId}
                          className={`relative p-3 rounded-xl border text-center cursor-pointer transition-all ${
                            isSelected ? "bg-blue-50/60 border-blue-400 shadow-sm" : "bg-white border-slate-200 hover:border-blue-300 hover:bg-blue-50/30"
                          }`}
                          onClick={() => { setSelected(s); setQueue([]); setSelectedVehicleForBooking(null); setSelectedSeats([]); saveSelectedVehicle(null); setLoading(false); }}>
                          {bookedCountForCard > 0 && (
                            <div className="absolute top-2 right-2 px-2 py-1 rounded-full bg-blue-600 text-white text-[10px] font-bold shadow-sm shadow-blue-600/25 tabular-nums">
                              {bookedCountForCard} sièges
                            </div>
                          )}
                          <h3 className="text-xs font-semibold text-slate-700 mb-1.5">{s.destinationName}</h3>
                          {s.totalVehicles > 0 ? (
                            <>
                              <p className={`text-xl font-bold ${isSelected ? 'text-blue-600' : 'text-slate-800'}`}>{s.availableSeats}</p>
                              <span className="text-[10px] text-slate-400">places dispo</span>
                              <div className="text-[10px] text-slate-400 mt-0.5 font-medium">{s.totalVehicles} véh.</div>
                            </>
                          ) : (
                            <>
                              <p className="text-lg font-bold text-slate-300 mt-1">0</p>
                              <span className="text-[10px] text-slate-400">Vide</span>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Normal mode actions */}
              <div className="border-t border-slate-100 bg-white px-5 py-2.5">
                <div className="flex justify-end gap-1.5">
                  <button onClick={handleEnterGhostMode}
                    className="h-8 px-3.5 rounded-lg bg-violet-600 text-xs font-medium text-white hover:bg-violet-700 transition-colors shadow-sm shadow-violet-600/20">
                    Mode Fantôme
                  </button>
                </div>
              </div>

              {/* Normal mode booking section */}
              {selected && (
                <div className="border-t border-slate-100 bg-white">
                  <div className="px-5 py-4">
                    <div className="mb-4 flex items-center justify-between">
                      <div>
                        <h3 className="text-sm font-bold text-slate-800">
                          Réservation — {selected?.destinationName}
                        </h3>
                        <div className="text-xs mt-0.5 text-slate-400">
                          {selectedVehicleForBooking
                            ? <><span className="font-mono font-medium text-blue-600">{selectedVehicleForBooking.licensePlate}</span></>
                            : 'Attribution automatique'}
                        </div>
                      </div>
                    </div>
                
                <div className="flex gap-6 items-end">
                  <div className="flex-1">
                    <div className="text-center mb-3">
                      <h4 className="text-[10px] font-semibold uppercase tracking-widest mb-2.5 text-slate-400">Nombre de sièges</h4>
                      <div className="grid grid-cols-4 gap-1.5 max-w-sm mx-auto">
                        {[1, 2, 3, 4, 5, 6, 7, 8].map((seatCount) => {
                          const availableSeatsForBooking = selectedVehicleForBooking ? selectedVehicleForBooking.availableSeats : (selected?.availableSeats ?? 0);
                          const isDisabled = seatCount > availableSeatsForBooking;
                          const isSel = selectedSeats.length === seatCount;
                          return (
                            <button key={seatCount} onClick={() => handleSeatCountSelect(seatCount)} disabled={isDisabled}
                              className={`h-11 rounded-xl border transition-all ${
                                isSel ? 'bg-blue-600 border-blue-600 text-white shadow-sm shadow-blue-600/25'
                                  : isDisabled ? 'bg-slate-50 border-slate-200 text-slate-300 cursor-not-allowed'
                                  : 'bg-white border-slate-200 text-slate-700 hover:border-blue-300 hover:bg-blue-50/50'
                              }`}>
                              <div className="text-sm font-bold">{seatCount}</div>
                            </button>
                          );
                        })}
                      </div>
                      <div className="text-[11px] mt-2 text-slate-400">
                        Dispo: {selectedVehicleForBooking ? selectedVehicleForBooking.availableSeats : (selected?.availableSeats ?? 0)}
                      </div>
                    </div>
                  </div>

                  <div className="w-72">
                    <div className="space-y-2.5">
                      {selectedVehicleForBooking && isSelectedVehicleStillInQueue && (
                        <Button
                          onClick={async () => {
                            if (!selectedVehicleForBooking || !isSelectedVehicleStillInQueue) {
                              showNotification("Annulation impossible: véhicule déjà sorti de la file.", 'error');
                              return;
                            }
                            setBookingLoading(true);
                            try {
                              await cancelOneBookingByQueueEntry({ queueEntryId: selectedVehicleForBooking.id });
                              showNotification(`1 siège annulé pour le véhicule ${selectedVehicleForBooking.licensePlate}`, 'success');
                              setLoading(true);
                              try {
                                const response = await listQueue(selected!.destinationId);
                                const items = (response.data as any[]).map((e) => ({
                                  ...e,
                                  availableSeats: Number(e.availableSeats ?? 0),
                                  totalSeats: Number(e.totalSeats ?? 0),
                                  queuePosition: Number(e.queuePosition ?? 0),
                                  bookedSeats: Number(e.bookedSeats ?? 0),
                                })) as QueueEntry[];
                                setQueue(items);
                                const summariesResponse = await listQueueSummaries();
                                setSummaries(
                                  (summariesResponse.data || []).map((s: any) => ({
                                    ...s,
                                    serviceFee:
                                      summaries.find((x) => x.destinationId === s.destinationId)?.serviceFee ??
                                      allDestinations.find((d) => d.id === s.destinationId)?.serviceFee ??
                                      0.2,
                                  }))
                                );
                              } finally { setLoading(false); }
                            } catch (error) {
                              showNotification((error as any)?.message || "Échec de l'annulation.", 'error');
                            } finally { setBookingLoading(false); }
                          }}
                          disabled={bookingLoading || !isSelectedVehicleStillInQueue}
                          variant="outline"
                          size="sm"
                          className="w-full h-9 text-xs bg-red-50 border-red-300 text-red-700 hover:bg-red-100"
                        >
                          Annuler 1 siège
                        </Button>
                      )}
                      
                      <div className="text-center">
                        <div className="text-lg font-bold mb-2 tabular-nums text-slate-800">
                          {(
                            selectedSeats.length *
                            ((selected?.basePrice || 0) + (selected?.serviceFee ?? 0.2))
                          ).toFixed(2)} <span className="text-xs font-semibold text-slate-400">TND</span>
                        </div>
                        <button
                          onClick={handleConfirmBooking}
                          disabled={bookingLoading || selectedSeats.length === 0}
                          className="w-full h-11 rounded-xl text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm shadow-emerald-600/25">
                          {bookingLoading ? (
                            <span className="flex items-center justify-center">
                              <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin mr-2"></div>
                              Traitement…
                            </span>
                          ) : (
                            `Réserver ${selectedSeats.length} siège${selectedSeats.length === 1 ? '' : 's'}`
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
            </>
          )}
        </div>
      </div>

      {/* Add Vehicle Modal */}
      <AddVehicleModal
        isOpen={addVehicleModalOpen}
        onClose={() => {
          setAddVehicleModalOpen(false);
          setVehicleSearchQuery('');
          setSearchResults([]);
          setSelectedVehicle(null);
          setSearchError(null);
          setLoadingSearch(false);
        }}
        searchQuery={vehicleSearchQuery}
        onSearchChange={handleSearchInputChange}
        searchResults={searchResults}
        loadingSearch={loadingSearch}
        onSelectVehicle={handleSelectVehicle}
        selectedVehicle={selectedVehicle}
        authorizedStations={vehicleAuthorizedStations}
        loadingStations={loadingVehicleStations}
        onConfirmAdd={handleConfirmAddVehicle}
        queue={queue}
        searchError={searchError}
      />

      {notification && (
        <div
          className={`fixed top-5 right-5 z-50 max-w-sm px-4 py-3 rounded-xl shadow-lg border backdrop-blur-sm transition-all ${
            notification.type === 'success' ? 'bg-emerald-50/95 text-emerald-800 border-emerald-200' : 'bg-red-50/95 text-red-800 border-red-200'
          }`}
          style={{ animation: 'toastIn 0.3s ease-out' }}
        >
          <div className="flex items-center gap-2.5">
            <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${notification.type === 'success' ? 'bg-emerald-100' : 'bg-red-100'}`}>
              {notification.type === 'success' ? (
                <svg className="w-3 h-3 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
              ) : (
                <svg className="w-3 h-3 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              )}
            </div>
            <span className="text-sm font-medium">{notification.message}</span>
          </div>
        </div>
      )}

      <style>{`
        @keyframes toastIn { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes modalIn { from { opacity: 0; transform: scale(0.97) translateY(8px); } to { opacity: 1; transform: scale(1) translateY(0); } }
      `}</style>

      {/* Trips / vehicle trips modals removed from staff app */}
    </div>
  );
}
