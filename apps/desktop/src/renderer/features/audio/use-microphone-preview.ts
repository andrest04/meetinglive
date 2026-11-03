import { useEffect, useState } from 'react';

/**
 * The idle level of a microphone, 0..100. It runs only while `enabled` (page visible, not
 * recording, microphone not None) and stops on the way out, so a recording can open the device.
 * `deviceId` null is the system default.
 */
export function useMicrophonePreview(deviceId: string | null, enabled: boolean): number {
  const [level, setLevel] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setLevel(0);
      return;
    }
    const unsubscribe = window.vozella.on('audio.preview.level', (payload) => {
      setLevel(Math.min(100, Math.max(0, payload.level)));
    });
    window.vozella.invoke('audio.preview.start', { deviceId }).catch(() => {
      // The preview is best effort: the bar just stays empty.
    });
    return () => {
      unsubscribe();
      window.vozella.invoke('audio.preview.stop', {}).catch(() => {
        // Nothing to undo.
      });
      setLevel(0);
    };
  }, [deviceId, enabled]);

  return level;
}
