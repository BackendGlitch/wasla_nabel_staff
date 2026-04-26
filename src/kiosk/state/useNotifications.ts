import { useCallback, useRef, useState } from 'react';
import type { NotificationKind, ToastNotification } from '@/kiosk/types';

/**
 * Toast notification state.
 *
 * Owns the single-slot toast that the legacy `MainPage` previously managed
 * inline. Behavior is identical: a toast auto-dismisses after 3000ms; calling
 * `showNotification` again replaces the current message and resets the timer.
 *
 * Returning `dismiss()` lets future kiosk screens cancel the toast eagerly
 * (e.g. when navigating away). The legacy MainPage never needed it, so it is
 * not yet consumed.
 */
export function useNotifications() {
  const [notification, setNotification] = useState<ToastNotification | null>(null);
  const timerRef = useRef<number | null>(null);

  const dismiss = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setNotification(null);
  }, []);

  const showNotification = useCallback(
    (message: string, type: NotificationKind = 'success') => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
      setNotification({ message, type });
      timerRef.current = window.setTimeout(() => {
        setNotification(null);
        timerRef.current = null;
      }, 3000);
    },
    [],
  );

  return { notification, showNotification, dismiss };
}

export type UseNotifications = ReturnType<typeof useNotifications>;
