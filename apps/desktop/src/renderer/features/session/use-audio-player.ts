import { useCallback, useRef, useState, type SyntheticEvent } from 'react';

/** Where the app serves the audio of one meeting (main/security/media-route.ts). */
export const audioUrl = (meetingId: string): string =>
  `vozella://app/media/${encodeURIComponent(meetingId)}`;

/** m:ss, or h:mm:ss from one hour. Non-finite or negative input reads as 0:00. */
export function formatClock(seconds: number): string {
  const whole = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const s = String(whole % 60).padStart(2, '0');
  const m = Math.floor(whole / 60);
  if (m < 60) return `${String(m)}:${s}`;
  return `${String(Math.floor(m / 60))}:${String(m % 60).padStart(2, '0')}:${s}`;
}

export interface AudioPlayer {
  readonly playing: boolean;
  readonly current: number;
  /** 0 until the file reports a finite length. */
  readonly duration: number;
  /** The file could not be played; the bar and the line seeking go away. */
  readonly failed: boolean;
  readonly toggle: () => void;
  readonly seek: (seconds: number) => void;
  /** Seeks and plays, for a click on a stamped transcript line. */
  readonly playFrom: (seconds: number) => void;
  /** Spread on the one <audio> element. */
  readonly audioProps: {
    readonly ref: (element: HTMLAudioElement | null) => void;
    readonly onTimeUpdate: (event: SyntheticEvent<HTMLAudioElement>) => void;
    readonly onDurationChange: (event: SyntheticEvent<HTMLAudioElement>) => void;
    readonly onPlay: () => void;
    readonly onPause: () => void;
    readonly onEnded: () => void;
    readonly onError: () => void;
  };
}

/** Playback state of the saved audio of the open meeting. Pure view state; the element is the truth. */
export function useAudioPlayer(): AudioPlayer {
  const element = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [failed, setFailed] = useState(false);

  const start = useCallback(() => {
    // play() rejects when the file cannot be decoded; the error event already reports that.
    element.current?.play().catch(() => undefined);
  }, []);

  const seek = useCallback((seconds: number) => {
    const audio = element.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, seconds);
    setCurrent(audio.currentTime);
  }, []);

  return {
    playing,
    current,
    duration,
    failed,
    toggle: () => {
      const audio = element.current;
      if (!audio) return;
      if (audio.paused) start();
      else audio.pause();
    },
    seek,
    playFrom: (seconds) => {
      seek(seconds);
      start();
    },
    audioProps: {
      ref: (node) => {
        element.current = node;
      },
      onTimeUpdate: (event) => {
        setCurrent(event.currentTarget.currentTime);
      },
      onDurationChange: (event) => {
        const length = event.currentTarget.duration;
        setDuration(Number.isFinite(length) ? length : 0);
      },
      onPlay: () => {
        setPlaying(true);
      },
      onPause: () => {
        setPlaying(false);
      },
      onEnded: () => {
        setPlaying(false);
      },
      onError: () => {
        setFailed(true);
        setPlaying(false);
      },
    },
  };
}
