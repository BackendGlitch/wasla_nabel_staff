import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'

interface UpdateInfo {
  version: string
  releaseDate?: string
  releaseNotes?: string
}

interface UpdateStatusProps {
  className?: string
}

export default function UpdateStatus({ className }: UpdateStatusProps) {
  const [updateStatus, setUpdateStatus] = useState<'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error'>('idle')
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [downloadProgress, setDownloadProgress] = useState(0)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [currentVersion, setCurrentVersion] = useState<string>('')

  useEffect(() => {
    // Get current app version
    if (window.electronAPI) {
      window.electronAPI.getAppVersion().then(version => {
        setCurrentVersion(version)
      })
    }

    // Listen for update events from main process
    if (window.electronAPI) {
      const handleUpdateAvailable = (_event: any, info: UpdateInfo) => {
        setUpdateInfo(info)
        setUpdateStatus('available')
        setErrorMessage(null)
      }

      const handleUpdateNotAvailable = (_event: unknown, _info: { version: string }) => {
        setUpdateStatus('idle')
        setErrorMessage(null)
      }

      const handleUpdateError = (_event: unknown, error: { message: string }) => {
        setUpdateStatus('error')
        setErrorMessage(error.message)
      }

      const handleDownloadProgress = (_event: unknown, progress: { percent: number }) => {
        setDownloadProgress(progress.percent)
        setUpdateStatus('downloading')
      }

      const handleUpdateDownloaded = (_event: unknown, _info: { version: string }) => {
        setUpdateStatus('downloaded')
        setDownloadProgress(100)
      }

      window.electronAPI.on('update-available', handleUpdateAvailable)
      window.electronAPI.on('update-not-available', handleUpdateNotAvailable)
      window.electronAPI.on('update-error', handleUpdateError)
      window.electronAPI.on('update-download-progress', handleDownloadProgress)
      window.electronAPI.on('update-downloaded', handleUpdateDownloaded)

      return () => {
        if (window.electronAPI) {
          window.electronAPI.off('update-available', handleUpdateAvailable)
          window.electronAPI.off('update-not-available', handleUpdateNotAvailable)
          window.electronAPI.off('update-error', handleUpdateError)
          window.electronAPI.off('update-download-progress', handleDownloadProgress)
          window.electronAPI.off('update-downloaded', handleUpdateDownloaded)
        }
      }
    }
  }, [])

  const handleCheckForUpdates = async () => {
    if (!window.electronAPI) {
      setErrorMessage('Auto-update non disponible en mode développement')
      return
    }

    setUpdateStatus('checking')
    setErrorMessage(null)
    
    try {
      const result = await window.electronAPI.checkForUpdates()
      if (!result.success) {
        setUpdateStatus('error')
        setErrorMessage(result.error || 'Erreur lors de la vérification des mises à jour')
      }
      // If update is available, the event handler will update the state
    } catch (error: any) {
      setUpdateStatus('error')
      setErrorMessage(error.message || 'Erreur lors de la vérification des mises à jour')
    }
  }

  const handleDownloadUpdate = async () => {
    if (!window.electronAPI) return

    try {
      const result = await window.electronAPI.downloadUpdate()
      if (!result.success) {
        setErrorMessage(result.error || 'Erreur lors du téléchargement')
      }
    } catch (error: any) {
      setErrorMessage(error.message || 'Erreur lors du téléchargement')
    }
  }

  const handleInstallUpdate = async () => {
    if (!window.electronAPI) return

    try {
      await window.electronAPI.installUpdate()
    } catch (error: any) {
      setErrorMessage(error.message || 'Erreur lors de l\'installation')
    }
  }

  // Don't show update status in development
  if (!window.electronAPI) {
    return null
  }

  return (
    <div className={className}>
      {updateStatus === 'idle' && (
        <Button
          variant="outline"
          size="sm"
          onClick={handleCheckForUpdates}
          className="h-8 px-3 text-xs"
          title="Vérifier les mises à jour"
        >
          <svg className="w-3 h-3 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Vérifier mise à jour
        </Button>
      )}

      {updateStatus === 'checking' && (
        <div className="flex items-center gap-2 text-xs text-gray-600">
          <div className="animate-spin rounded-full h-3 w-3 border-2 border-blue-600 border-t-transparent"></div>
          Vérification...
        </div>
      )}

      {updateStatus === 'available' && updateInfo && (
        <div className="flex items-center gap-2">
          <div className="text-xs text-blue-600 font-medium">
            v{updateInfo.version} disponible
          </div>
          <Button
            size="sm"
            onClick={handleDownloadUpdate}
            className="h-7 px-2 text-xs bg-blue-600 hover:bg-blue-700 text-white"
          >
            Télécharger
          </Button>
        </div>
      )}

      {updateStatus === 'downloading' && (
        <div className="flex items-center gap-2 min-w-[120px]">
          <div className="flex-1 bg-gray-200 rounded-full h-1.5 overflow-hidden">
            <div 
              className="bg-blue-600 h-full transition-all duration-300"
              style={{ width: `${downloadProgress}%` }}
            />
          </div>
          <span className="text-xs text-gray-600 w-8 text-right">{Math.round(downloadProgress)}%</span>
        </div>
      )}

      {updateStatus === 'downloaded' && (
        <div className="flex items-center gap-2">
          <div className="text-xs text-emerald-600 font-medium">
            Prêt à installer
          </div>
          <Button
            size="sm"
            onClick={handleInstallUpdate}
            className="h-7 px-2 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            Redémarrer
          </Button>
        </div>
      )}

      {updateStatus === 'error' && errorMessage && (
        <div className="flex items-center gap-2">
          <div className="text-xs text-red-600">
            Erreur
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleCheckForUpdates}
            className="h-7 px-2 text-xs"
          >
            Réessayer
          </Button>
        </div>
      )}

      {currentVersion && (
        <div className="text-xs text-gray-500 ml-2">
          v{currentVersion}
        </div>
      )}
    </div>
  )
}

