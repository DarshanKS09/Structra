"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReminderNotification } from "@/lib/data/notifications";
import { markHandled, playAlarm, shouldSound, type AlarmSettings } from "@/lib/reminders/alarm";

/**
 * Sounds the alarm when a reminder ARRIVES, and tracks the one currently sounding.
 *
 * ---------------------------------------------------------------------------
 * WHY ONLY ARRIVALS SOUND, NOT EVERYTHING ON SCREEN
 * ---------------------------------------------------------------------------
 * `notifications` is re-read on a 60s poll, so the same rows arrive repeatedly.
 * It is also populated on mount with reminders that were raised earlier - possibly
 * while the browser was closed, in which case the email already went out.
 *
 * So the first batch after mount is marked handled WITHOUT sounding. Only rows
 * that appear afterwards are treated as new. That is what stops the alarm
 * re-firing on every poll, every render, and every navigation - and it is why a
 * page load after a reminder already emailed does not replay the alarm.
 *
 * A reminder raised while Structra is closed is, by definition, not an arrival, so
 * it does not sound. That is a platform limit, documented in the UI.
 *
 * ---------------------------------------------------------------------------
 * ONE ALARM AT A TIME
 * ---------------------------------------------------------------------------
 * Several reminders can fall due together. Stacking synthesised tones produces an
 * unpleasant roar and multiple stop handles nobody can reason about, so a new alarm
 * replaces the previous one and the banner keeps listing everything pending.
 */
export function useReminderAlarm(
  notifications: ReminderNotification[],
  settings: AlarmSettings,
  enabled: boolean
): {
  /** True while an alarm is sounding, so the UI can offer a stop control. */
  sounding: boolean;
  stopSound: () => void;
} {
  const [sounding, setSounding] = useState(false);

  const handleRef = useRef<{ stop: () => void } | null>(null);
  // Read through a ref so changing the sound preference does not restart an alarm
  // that is already playing.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const stopSound = useCallback(() => {
    handleRef.current?.stop();
    handleRef.current = null;
    setSounding(false);
  }, []);

  const primed = useRef(false);

  useEffect(() => {
    // First batch after mount: acknowledge without sounding. Anything already on
    // screen was raised before this page was watching.
    if (!primed.current) {
      primed.current = true;
      markHandled(notifications.map((row) => row.id));
      return;
    }

    if (!enabled || notifications.length === 0) return;

    const fresh = notifications.filter((row) => shouldSound(row.id));
    if (fresh.length === 0) return;

    // Replace rather than layer, so a burst of reminders is one audible alarm.
    handleRef.current?.stop();
    handleRef.current = playAlarm(settingsRef.current.sound, settingsRef.current.maxSeconds);
    setSounding(true);
  }, [notifications, enabled, stopSound]);

  // Turning the setting off must silence anything already playing.
  useEffect(() => {
    if (!enabled) stopSound();
  }, [enabled, stopSound]);

  // Never leave a tone running once the view unmounts.
  useEffect(
    () => () => {
      handleRef.current?.stop();
      handleRef.current = null;
    },
    []
  );

  return { sounding, stopSound };
}