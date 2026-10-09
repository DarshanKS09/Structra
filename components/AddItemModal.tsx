import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { type DraftByMode, type ListItem, type ListMode, modeLabels } from "@/types/taskTypes";
import {
  toDateTimeInputValue,
  fromDateTimeInputValue,
  validateStudyDuration
} from "@/lib/data/adapters";
import { normaliseGroceryUnit } from "@/lib/data/groceries";
import {
  REMINDER_OPTIONS,
  REMINDER,
  formatReminderOffset,
  reminderDueAt
} from "@/lib/data/reminders";

type Props = {
  mode: ListMode;
  isOpen: boolean;
  editingItem?: ListItem;
  onClose: () => void;
  onSubmit: <M extends ListMode>(mode: M, data: DraftByMode[M]) => void;
  onUpdate: <M extends ListMode>(mode: M, id: string, data: Partial<DraftByMode[M]>) => void;
};

type FormState = Record<string, string | number | boolean | null>;

const inputBaseClass =
  "themed-accent-ring w-full rounded-2xl border border-white/20 bg-white/10 px-3 py-3 text-sm text-slate-100 outline-none backdrop-blur-sm placeholder:text-slate-300/75";

const defaults: Record<ListMode, FormState> = {
  task: { title: "", description: "", priority: "Medium", dueDate: "", reminderOffsetMinutes: REMINDER.NONE, completed: false },
  grocery: { itemName: "", quantity: "", unit: "pieces", purchased: false },
  habit: { habitName: "", frequency: "Daily", streak: 0, completed: false },
  study: { subject: "", topic: "", durationValue: "30", durationUnit: "minutes", completed: false },
  fitness: { exerciseName: "", sets: 3, reps: 10, duration: "20 min", completed: false },
  shopping: { itemName: "", price: 0, priority: "Medium", purchased: false },
  meeting: { meetingTitle: "", participants: "", date: "", notes: "" }
};

const toDraft = <M extends ListMode>(mode: M, form: FormState): DraftByMode[M] => {
  switch (mode) {
    case "task":
      return {
        title: String(form.title || ""),
        description: String(form.description || ""),
        priority: form.priority as "Low" | "Medium" | "High",
        dueDate: String(form.dueDate || ""),
        reminderOffsetMinutes:
          form.reminderOffsetMinutes === null || form.reminderOffsetMinutes === undefined
            ? null
            : Number(form.reminderOffsetMinutes) || null,
        completed: Boolean(form.completed)
      } as DraftByMode[M];
    case "grocery":
      return {
        itemName: String(form.itemName || ""),
        quantity: Number(form.quantity || 0),
        /*
         * `normaliseGroceryUnit` rather than a bare `as` cast.
         *
         * The cast asserted that the value was already one of the four enum
         * members without checking, which is exactly the assumption that lets an
         * unsupported unit reach the database and fail a whole batch insert with
         * `invalid input value for enum grocery_unit`. The normaliser narrows the
         * same `string` to the same union, but it VERIFIES rather than asserts,
         * and it falls back to "pieces" - the default the rest of the grocery
         * model already uses - so a bad value degrades to a sensible unit instead
         * of an exception at save time.
         */
        unit: normaliseGroceryUnit(form.unit) ?? "pieces",
        purchased: Boolean(form.purchased)
      } as DraftByMode[M];
    case "habit":
      return {
        habitName: String(form.habitName || ""),
        frequency: form.frequency as "Daily" | "Weekly",
        streak: Number(form.streak || 0),
        completed: Boolean(form.completed)
      } as DraftByMode[M];
    case "study": {
        /*
         * The unit is chosen, not typed, so this is one multiplication rather than
         * a guess. `validateStudyDuration` has already run by the time submit is
         * reached; re-validating here keeps the draft honest even if it is ever
         * built outside the form.
         */
        const unit = form.durationUnit === "hours" ? "hours" : "minutes";
        const check = validateStudyDuration(form.durationValue, unit);
        return {
          subject: String(form.subject || ""),
          topic: String(form.topic || ""),
          durationMinutes: check.ok ? check.minutes : 0,
          completed: Boolean(form.completed)
        } as DraftByMode[M];
      }
    case "fitness":
      return {
        exerciseName: String(form.exerciseName || ""),
        sets: Number(form.sets || 0),
        reps: Number(form.reps || 0),
        duration: String(form.duration || ""),
        completed: Boolean(form.completed)
      } as DraftByMode[M];
    case "shopping":
      return {
        itemName: String(form.itemName || ""),
        price: Number(form.price || 0),
        priority: form.priority as "Low" | "Medium" | "High",
        purchased: Boolean(form.purchased)
      } as DraftByMode[M];
    case "meeting":
      return {
        meetingTitle: String(form.meetingTitle || ""),
        participants: String(form.participants || ""),
        date: String(form.date || ""),
        notes: String(form.notes || "")
      } as DraftByMode[M];
  }
};

export function AddItemModal({ mode, isOpen, editingItem, onClose, onSubmit, onUpdate }: Props) {
  /**
   * Seeds the form from an item being edited.
   *
   * The task deadline needs converting: `TaskItem.dueDate` holds a full ISO
   * instant while `<input type="datetime-local">` expects `YYYY-MM-DDTHH:mm` in
   * local time. Feeding the raw ISO straight in would render blank or wrong,
   * because the input's value format is not the same string shape.
   */
  const initial = useMemo(() => {
    if (!editingItem) return { ...defaults[mode] };
    const merged: FormState = { ...defaults[mode], ...editingItem };
    if (mode === "task" && editingItem.mode === "task") {
      merged.dueDate = toDateTimeInputValue(editingItem.dueDate || null);
      merged.reminderOffsetMinutes = editingItem.reminderOffsetMinutes ?? REMINDER.NONE;
    }
    if (mode === "study" && editingItem.mode === "study") {
      /*
       * Split the stored minutes into the number and unit the new controls show.
       *
       * Exact hours are shown as hours (60 -> "1" + Hours), and anything else as
       * minutes (90 -> "90" + Minutes), so the number shown always equals the
       * number stored - a prefill that quietly changed 60 minutes into "1 hour"
       * would be a second source of the rounding surprise this field already had.
       */
      const minutes = Math.max(1, Math.round(editingItem.durationMinutes || 0));
      const isWholeHours = minutes >= 60 && minutes % 60 === 0;
      // The VALUE must match the UNIT. Writing "60" beside "Hours" would show
      // 60 hours and silently multiply an hour-long session by 60 on the next
      // save - the same class of bug this field was rebuilt to remove.
      merged.durationValue = String(isWholeHours ? minutes / 60 : minutes);
      merged.durationUnit = isWholeHours ? "hours" : "minutes";
      merged.durationError = null;
    }
    return merged;
  }, [editingItem, mode]);
  const [form, setForm] = useState<FormState>(initial);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    setForm(initial);
  }, [initial]);

  useEffect(() => {
    if (!isOpen) return;
    if (!editingItem) {
      setForm({ ...defaults[mode] });
    }
    const timer = setTimeout(() => {
      const firstInput = formRef.current?.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        "input[type='text'], input:not([type]), textarea"
      );
      firstInput?.focus();
    }, 0);
    return () => clearTimeout(timer);
  }, [isOpen, mode, editingItem]);

  const setValue = (key: string, value: string | number | boolean) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    /*
     * Validate the duration before building the draft.
     *
     * The number input carries `required` and `min={1}`, but that is a
     * convenience: it does not stop a fractional value, and a browser can be
     * configured to ignore form validation entirely. The data layer also rejects
     * a non-positive duration, so this is the user-facing half of one rule, not
     * the only half.
     *
     * The entered value is never coerced. An invalid entry shows why and stops
     * here, rather than being quietly rounded into a different duration.
     */
    if (mode === "study") {
      const unit = form.durationUnit === "hours" ? "hours" : "minutes";
      const check = validateStudyDuration(form.durationValue, unit);
      if (!check.ok) {
        setForm((prev) => ({ ...prev, durationError: check.message }));
        return;
      }
      setForm((prev) => ({ ...prev, durationError: null }));
    }

    const draft = toDraft(mode, form);
    if (editingItem) {
      onUpdate(mode, editingItem.id, draft);
    } else {
      onSubmit(mode, draft);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-black/45 backdrop-blur-sm"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          <motion.div
            initial={{ opacity: 0, y: 22 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 22 }}
            transition={{ type: "spring", stiffness: 260, damping: 24 }}
            className="fixed bottom-0 left-0 right-0 z-50 mx-auto w-full max-w-xl rounded-t-[2rem] border border-white/15 bg-slate-900/95 p-5 pb-8 shadow-2xl backdrop-blur-xl light:border-slate-300 light:bg-slate-100/95"
          >
            <h2 className="text-lg font-semibold">
              {editingItem ? "Edit" : "New"} {modeLabels[mode]}
            </h2>
            <form ref={formRef} className="mt-4 space-y-3" onSubmit={submit}>
              <Fields mode={mode} form={form} setValue={setValue} />
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="h-12 flex-1 rounded-2xl border border-white/20 text-sm font-medium light:border-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="themed-accent-solid h-12 flex-1 rounded-2xl text-sm font-semibold"
                >
                  {editingItem ? "Save Changes" : "Add Item"}
                </button>
              </div>
            </form>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function Fields({
  mode,
  form,
  setValue
}: {
  mode: ListMode;
  form: FormState;
  setValue: (key: string, value: string | number | boolean) => void;
}) {
  switch (mode) {
    case "task":
      return (
        <>
          <input
            required
            className={inputBaseClass}
            placeholder="Title"
            value={String(form.title || "")}
            onChange={(e) => setValue("title", e.target.value)}
          />
          <textarea
            className={inputBaseClass}
            rows={3}
            placeholder="Description"
            value={String(form.description || "")}
            onChange={(e) => setValue("description", e.target.value)}
          />

          {/*
            The deadline is REQUIRED.

            `required` is a convenience for the user, not the guarantee - the
            data-access layer rejects a create without a deadline as well, so the
            rule holds for any write path.

            A native `datetime-local` input is used rather than a custom picker:
            it is keyboard accessible, uses the device's own locale format, and
            on mobile opens the native date/time wheel. It needs no new
            dependency and no bespoke UI to keep consistent across platforms.

            The value round-trips through `toDateTimeInputValue` /
            `fromDateTimeInputValue` so what the user picked as their local 09:00
            is stored as the instant that actually is 09:00 for them.
          */}
          <label className="block">
            <span className="mb-1 block text-xs text-slate-300 light:text-slate-600">
              Deadline <span className="text-rose-300 light:text-rose-600">*</span>
            </span>
            <input
              type="datetime-local"
              required
              className={inputBaseClass}
              value={String(form.dueDate || "")}
              onChange={(e) => setValue("dueDate", e.target.value)}
            />
          </label>

          <OptionPills
            value={String(form.priority || "Medium")}
            options={["Low", "Medium", "High"]}
            onChange={(value) => setValue("priority", value)}
          />

          <label className="block">
            <span className="mb-1 block text-xs text-slate-300 light:text-slate-600">
              Reminder
            </span>
            <select
              className={`${inputBaseClass} appearance-none`}
              value={String(form.reminderOffsetMinutes ?? REMINDER.NONE)}
              onChange={(e) => setValue("reminderOffsetMinutes", Number(e.target.value))}
            >
              {REMINDER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value} className="bg-slate-900">
                  {option.label}
                </option>
              ))}
            </select>
            {/*
              Explains where the reminder will actually land. Without this the
              offset is a bare number the user has to interpret themselves.
            */}
            <span className="mt-1 block text-[11px] text-slate-400 light:text-slate-500">
              {form.dueDate
                ? (() => {
                    const fire = reminderDueAt(
                      fromDateTimeInputValue(String(form.dueDate)),
                      form.reminderOffsetMinutes === null
                        ? null
                        : Number(form.reminderOffsetMinutes)
                    );
                    if (!fire) return "No reminder will be scheduled for this task.";
                    return `Will remind you ${formatReminderOffset(
                      Number(form.reminderOffsetMinutes)
                    )} — ${new Date(fire).toLocaleString()}.`;
                  })()
                : "Set a deadline to choose when to be reminded."}
            </span>
          </label>
        </>
      );
    case "grocery":
      return (
        <>
          <input
            required
            className={inputBaseClass}
            placeholder="Item Name"
            value={String(form.itemName || "")}
            onChange={(e) => setValue("itemName", e.target.value)}
          />
          <div className="grid grid-cols-2 gap-3">
            <input
              type="number"
              required
              min={0}
              step="any"
              className={inputBaseClass}
              placeholder="Quantity"
              value={String(form.quantity ?? "")}
              onChange={(e) =>
                setValue("quantity", e.target.value === "" ? "" : Number(e.target.value))
              }
            />
            <OptionPills
              value={String(form.unit || "pieces")}
              options={["kg", "g", "pieces", "liters"]}
              onChange={(value) => setValue("unit", value)}
            />
          </div>
        </>
      );
    case "habit":
      return (
        <>
          <input
            required
            className={inputBaseClass}
            placeholder="Habit Name"
            value={String(form.habitName || "")}
            onChange={(e) => setValue("habitName", e.target.value)}
          />
          <div className="grid grid-cols-2 gap-3">
            <OptionPills
              value={String(form.frequency || "Daily")}
              options={["Daily", "Weekly"]}
              onChange={(value) => setValue("frequency", value)}
            />
            <input
              type="number"
              min={0}
              className={inputBaseClass}
              placeholder="Streak"
              value={Number(form.streak || 0)}
              onChange={(e) => setValue("streak", Number(e.target.value))}
            />
          </div>
        </>
      );
    case "study":
      return (
        <>
          <input
            required
            className={inputBaseClass}
            placeholder="Subject"
            value={String(form.subject || "")}
            onChange={(e) => setValue("subject", e.target.value)}
          />
          <input
            required
            className={inputBaseClass}
            placeholder="Topic"
            value={String(form.topic || "")}
            onChange={(e) => setValue("topic", e.target.value)}
          />
          {/*
            Duration: a NUMBER plus an explicit unit.

            This used to be one free-text field ("45 min"), which left the unit
            to be inferred from what the user typed. That ambiguity is what let a
            minutes value reach a seconds-based formatter and print 60 minutes as
            "1 min". With the unit chosen rather than typed, there is nothing left
            to infer.
          */}
          <div className="flex gap-2">
            <input
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              required
              aria-label="Study duration"
              placeholder="Duration"
              className={inputBaseClass}
              value={String(form.durationValue ?? "")}
              onChange={(e) => setValue("durationValue", e.target.value)}
            />
            <select
              aria-label="Duration unit"
              className={`${inputBaseClass} w-28 shrink-0`}
              value={String(form.durationUnit ?? "minutes")}
              onChange={(e) => setValue("durationUnit", e.target.value)}
            >
              <option value="minutes">Minutes</option>
              <option value="hours">Hours</option>
            </select>
          </div>
          {form.durationError ? (
            <p role="alert" className="text-[11px] text-rose-300 light:text-rose-600">
              {String(form.durationError)}
            </p>
          ) : null}
        </>
      );
    case "fitness":
      return (
        <>
          <input
            required
            className={inputBaseClass}
            placeholder="Exercise Name"
            value={String(form.exerciseName || "")}
            onChange={(e) => setValue("exerciseName", e.target.value)}
          />
          <div className="grid grid-cols-3 gap-3">
            <input
              type="number"
              min={0}
              className={inputBaseClass}
              placeholder="Sets"
              value={Number(form.sets || 0)}
              onChange={(e) => setValue("sets", Number(e.target.value))}
            />
            <input
              type="number"
              min={0}
              className={inputBaseClass}
              placeholder="Reps"
              value={Number(form.reps || 0)}
              onChange={(e) => setValue("reps", Number(e.target.value))}
            />
            <input
              className={inputBaseClass}
              placeholder="Duration"
              value={String(form.duration || "")}
              onChange={(e) => setValue("duration", e.target.value)}
            />
          </div>
        </>
      );
    case "shopping":
      return (
        <>
          <input
            required
            className={inputBaseClass}
            placeholder="Item Name"
            value={String(form.itemName || "")}
            onChange={(e) => setValue("itemName", e.target.value)}
          />
          <div className="grid grid-cols-2 gap-3">
            <input
              type="number"
              min={0}
              className={inputBaseClass}
              placeholder="Price"
              value={Number(form.price || 0)}
              onChange={(e) => setValue("price", Number(e.target.value))}
            />
            <OptionPills
              value={String(form.priority || "Medium")}
              options={["Low", "Medium", "High"]}
              onChange={(value) => setValue("priority", value)}
            />
          </div>
        </>
      );
    case "meeting":
      return (
        <>
          <input
            required
            className={inputBaseClass}
            placeholder="Meeting Title"
            value={String(form.meetingTitle || "")}
            onChange={(e) => setValue("meetingTitle", e.target.value)}
          />
          <input
            className={inputBaseClass}
            placeholder="Participants"
            value={String(form.participants || "")}
            onChange={(e) => setValue("participants", e.target.value)}
          />
          <input
            type="date"
            className={inputBaseClass}
            value={String(form.date || "")}
            onChange={(e) => setValue("date", e.target.value)}
          />
          <textarea
            className={inputBaseClass}
            rows={3}
            placeholder="Notes"
            value={String(form.notes || "")}
            onChange={(e) => setValue("notes", e.target.value)}
          />
        </>
      );
  }
}

function OptionPills({
  value,
  options,
  onChange
}: {
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 rounded-2xl border border-white/20 bg-white/5 p-1 light:border-slate-300 light:bg-white">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={`h-10 rounded-xl text-xs font-medium ${
            value === option
              ? "themed-accent-solid"
              : "text-slate-200 light:text-slate-700"
          }`}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
