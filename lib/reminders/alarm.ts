"use client";

/**
 * The audible reminder alarm.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS CAN AND CANNOT DO - READ BEFORE CHANGING
 * ---------------------------------------------------------------------------
 * Browsers enforce an autoplay policy: no `AudioContext` may produce sound until
 * the user has interacted with the page. There is no API to bypass this. So the
 * alarm needs an "unlock" gesture - in Structra that is the "Test alarm" button in
 * Profile - and if the user has never interacted, the alarm cannot sound. It
 * degrades to the in-app reminder list and the reminder email, both of which
 * already work.
 *
 * If Structra is CLOSED, no browser JavaScript runs, so nothing here can sound.
 * Delivery while closed is the scheduled email sweep
 * (`pages/api/reminders/dispatch`). That is a hard platform limit, not something
 * this code can engineer around, and the UI says so plainly rather than implying
 * a guarantee.
 *
 * ---------------------------------------------------------------------------
 * WHY WEB AUDIO AND NOT AN AUDIO FILE
 * ---------------------------------------------------------------------------
 * Tones are generated with an `OscillatorNode`. No asset is fetched, nothing is
 * bundled, there is no decode latency before the first beep, and it works offline.
 * A file would add a request and a loading state to the one moment the user most
 * needs instant feedback.
 *
 * ---------------------------------------------------------------------------
 * WHY DEDUPE IS A MODULE-LEVEL SET OF NOTIFICATION IDS
 * ---------------------------------------------------------------------------
 * Reminders arrive as persisted `task_notifications` rows, re-read on a 60s poll
 * and on every task mutation. The same row therefore appears many times.
 *
 * The key is the notification's own `id`. That is exactly right in both
 * directions: a re-read of the same row never re-sounds (so rerenders, polls,
 * navigation and duplicate scheduler events are all absorbed), while a genuinely
 * re-armed reminder - a deadline edit - produces a NEW row with a new id, and so
 * does sound again.
 *
 * It has to be module scope rather than a `useRef`, because a ref resets when the
 * component unmounts, and it unmounts on every navigation.
 */

export type AlarmSound = "chime" | "beep" | "siren";

export const ALARM_SOUNDS: { id: AlarmSound; label: string; description: string }[] = [
  { id: "chime", label: "Chime", description: "Soft two-tone chime" },
  { id: "beep", label: "Beep", description: "Short repeating beep" },
  { id: "siren", label: "Siren", description: "Rising two-tone sweep" }
];

export type AlarmSettings = {
  enabled: boolean;
  sound: AlarmSound;
  /** How long one alarm runs before it stops on its own. */
  maxSeconds: number;
};

export const DEFAULT_ALARM_SETTINGS: AlarmSettings = {
  enabled: true,
  sound: "chime",
  maxSeconds: 20
};

const MAX_SECONDS_CAP = 60;

/**
 * Coerces whatever is in the `preferences` jsonb into valid settings.
 *
 * `preferences` is untyped json, so a stale or hand-edited value must never be
 * able to produce an unusable setting (an unknown sound id, a negative duration).
 * Anything unrecognised falls back to the default rather than throwing.
 */
export const readAlarmSettings = (raw: unknown): AlarmSettings => {
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const nested = (source.alarm && typeof source.alarm === "object" ? source.alarm : {}) as Record<
    string,
    unknown
  >;

  const sound = nested.sound;
  const maxSeconds = Number(nested.maxSeconds);

  return {
    enabled: typeof nested.enabled === "boolean" ? nested.enabled : DEFAULT_ALARM_SETTINGS.enabled,
    sound: ALARM_SOUNDS.some((option) => option.id === sound)
      ? (sound as AlarmSound)
      : DEFAULT_ALARM_SETTINGS.sound,
    maxSeconds:
      Number.isFinite(maxSeconds) && maxSeconds > 0
        ? Math.min(Math.round(maxSeconds), MAX_SECONDS_CAP)
        : DEFAULT_ALARM_SETTINGS.maxSeconds
  };
};

/** Merges alarm settings into a `preferences` object without dropping other keys. */
export const mergeAlarmSettings = (
  preferences: unknown,
  settings: AlarmSettings
): Record<string, unknown> => {
  const base =
    preferences && typeof preferences === "object" ? { ...(preferences as Record<string, unknown>) } : {};
  return { ...base, alarm: { enabled: settings.enabled, sound: settings.sound, maxSeconds: settings.maxSeconds } };
};

// ---------------------------------------------------------------------------
// Dedupe
// ---------------------------------------------------------------------------

/** Notification ids already accounted for in this tab. */
const handled = new Set<string>();

/**
 * True the first time a notification id is offered, false on every later sighting.
 *
 * Callers mark the pre-existing rows as handled on their first load, so only
 * reminders that genuinely ARRIVE while the page is open sound.
 */
export const shouldSound = (notificationId: string): boolean => {
  if (handled.has(notificationId)) return false;
  handled.add(notificationId);
  return true;
};

/** Marks ids as already accounted for without sounding them. */
export const markHandled = (notificationIds: readonly string[]): void => {
  for (const id of notificationIds) handled.add(id);
};

/** Lets a notification sound again - used by the "Test alarm" preview. */
export const resetAlarm = (notificationId?: string): void => {
  if (notificationId === undefined) {
    handled.clear();
    return;
  }
  handled.delete(notificationId);
};

// ---------------------------------------------------------------------------
// Web Audio
// ---------------------------------------------------------------------------

let audioContext: AudioContext | null = null;
let unlockFailed = false;

type AudioContextCtor = new () => AudioContext;

const getAudioContext = (): AudioContext | null => {
  if (typeof window === "undefined") return null;
  if (audioContext) return audioContext;
  const Ctor =
    (window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor })
      .AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    audioContext = new Ctor();
    return audioContext;
  } catch {
    unlockFailed = true;
    return null;
  }
};

/** Whether audio is currently permitted to start without a fresh gesture. */
export const isAudioUnlocked = (): boolean => {
  const ctx = getAudioContext();
  return ctx !== null && ctx.state === "running";
};

/**
 * Unlocks audio by playing a silent buffer inside a user gesture.
 *
 * Must be called from a real event handler (a click), not an effect. Resolves to
 * whether audio is now usable, so the UI can tell the user plainly when it is not
 * rather than leaving them wondering why nothing sounds.
 */
export const unlockAudio = async (): Promise<boolean> => {
  const ctx = getAudioContext();
  if (!ctx) return false;
  if (ctx.state === "running") return true;
  try {
    // A zero-length buffer at zero volume: enough to satisfy the gesture
    // requirement, inaudible in practice.
    const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    source.connect(gain).connect(ctx.destination);
    source.start(0);
    if (typeof ctx.resume === "function") await ctx.resume();
    // Read through the accessor: `ctx.state` was narrowed to "suspended" by the
    // guard above, so comparing it directly would not typecheck even though the
    // value genuinely can change once resume() settles.
    return getAudioContext()?.state === "running";
  } catch {
    unlockFailed = true;
    return false;
  }
};

/** Why audio could not start, for the UI to explain. */
export const audioBlockedReason = (): string | null => {
  if (unlockFailed) return "This browser blocked audio for Structra.";
  const ctx = getAudioContext();
  if (ctx && ctx.state === "suspended") {
    return "Click anywhere in Structra once to allow reminder sounds.";
  }
  return null;
};

type StopHandle = { stop: () => void };

/**
 * Plays one alarm.
 *
 * Returns a handle so the caller can stop it early - the in-app banner's "Stop"
 * button and any subsequent dismissal both use it. Stopping matters: an alarm
 * that cannot be silenced is worse than no alarm.
 */
export const playAlarm = (sound: AlarmSound, maxSeconds = DEFAULT_ALARM_SETTINGS.maxSeconds): StopHandle => {
  const ctx = getAudioContext();
  const noop: StopHandle = { stop: () => undefined };
  if (!ctx) return noop;

  // Autoplay policy: refuse rather than throw. The caller shows the banner and the
  // email still goes out. The state is re-read after `resume` because it only
  // settles asynchronously.
  if (ctx.state === "suspended") {
    void ctx.resume().catch(() => undefined);
    if (getAudioContext()?.state === "suspended") return noop;
  }

  const limit = Math.max(1, Math.min(Math.round(maxSeconds), MAX_SECONDS_CAP)) * 1000;
  const startAt = ctx.currentTime;
  const endAt = startAt + limit / 1000;

  const master = ctx.createGain();
  // Kept low: this can fire without the user looking at the screen.
  master.gain.value = 0.18;
  master.connect(ctx.destination);

  const oscillators: OscillatorNode[] = [];
  const timers: ReturnType<typeof setTimeout>[] = [];

  const beep = (at: number, freq: number, duration: number, peak = 1) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, at);
    gain.gain.setValueAtTime(0.0001, at);
    // Short attack/decay so consecutive beeps do not click.
    gain.gain.exponentialRampToValueAtTime(peak, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    osc.connect(gain).connect(master);
    osc.start(at);
    osc.stop(at + duration + 0.02);
    oscillators.push(osc);
  };

  if (sound === "chime") {
    // Two soft tones, repeated.
    for (let t = startAt; t < endAt; t += 1.6) {
      beep(t, 880, 0.35);
      beep(t + 0.4, 1320, 0.5);
    }
  } else if (sound === "beep") {
    // Evenly spaced, single pitch.
    for (let t = startAt; t < endAt; t += 0.6) {
      beep(t, 1046, 0.18);
    }
  } else {
    // A rising sweep, repeated.
    for (let t = startAt; t < endAt; t += 1.2) {
      beep(t, 440, 0.28);
      beep(t + 0.3, 660, 0.28);
      beep(t + 0.6, 880, 0.3);
    }
  }

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    for (const osc of oscillators) {
      try {
        osc.stop();
      } catch {
        // Already stopped - harmless.
      }
    }
    for (const timer of timers) clearTimeout(timer);
    try {
      master.disconnect();
    } catch {
      // Already disconnected.
    }
  };

  // Belt and braces: stop at the limit even if a caller forgets to.
  const timer = setTimeout(stop, limit);
  timers.push(timer);

  return { stop };
};