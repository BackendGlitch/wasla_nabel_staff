import type { ToastNotification } from '@/kiosk/types';
import { ZIndex } from '@/kiosk/tokens';

interface ToastProps {
  notification: ToastNotification | null;
}

/**
 * Single-slot toast notification.
 *
 * Visual is intentionally identical to the legacy `MainPage` toast so that
 * Step 2 introduces no visual regression for users who toggle into the kiosk
 * preview. Toast lifetime (auto-dismiss after 3000ms) is owned by
 * `useNotifications`; this component is purely presentational.
 */
export function Toast({ notification }: ToastProps) {
  if (!notification) return null;

  return (
    <div
      className={`fixed top-5 right-5 max-w-sm px-4 py-3 rounded-xl shadow-lg border backdrop-blur-sm transition-all ${
        notification.type === 'success'
          ? 'bg-emerald-50/95 text-emerald-800 border-emerald-200'
          : 'bg-red-50/95 text-red-800 border-red-200'
      }`}
      style={{ animation: 'toastIn 0.3s ease-out', zIndex: ZIndex.toast }}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2.5">
        <div
          className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${
            notification.type === 'success' ? 'bg-emerald-100' : 'bg-red-100'
          }`}
        >
          {notification.type === 'success' ? (
            <svg
              className="w-3 h-3 text-emerald-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="3"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg
              className="w-3 h-3 text-red-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="3"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          )}
        </div>
        <span className="text-sm font-medium">{notification.message}</span>
      </div>
    </div>
  );
}
