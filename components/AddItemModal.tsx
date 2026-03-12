import { type FormEvent, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { type DraftByMode, type ListItem, type ListMode, modeLabels } from "@/types/taskTypes";

type Props = {
  mode: ListMode;
  isOpen: boolean;
  editingItem?: ListItem;
  onClose: () => void;
  onSubmit: <M extends ListMode>(mode: M, data: DraftByMode[M]) => void;
  onUpdate: <M extends ListMode>(mode: M, id: string, data: Partial<DraftByMode[M]>) => void;
};

type FormState = Record<string, string | number | boolean>;

const inputBaseClass =
  "themed-accent-ring w-full rounded-2xl border border-white/20 bg-white/10 px-3 py-3 text-sm text-slate-100 outline-none backdrop-blur-sm placeholder:text-slate-300/75";

const defaults: Record<ListMode, FormState> = {
  task: { title: "", description: "", priority: "Medium", dueDate: "", completed: false },
  grocery: { itemName: "", quantity: 1, unit: "pieces", purchased: false },
  habit: { habitName: "", frequency: "Daily", streak: 0, completed: false },
  study: { subject: "", topic: "", estimatedStudyTime: "30 min", completed: false },
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
        completed: Boolean(form.completed)
      } as DraftByMode[M];
    case "grocery":
      return {
        itemName: String(form.itemName || ""),
        quantity: Number(form.quantity || 1),
        unit: form.unit as "kg" | "g" | "pieces" | "liters",
        purchased: Boolean(form.purchased)
      } as DraftByMode[M];
    case "habit":
      return {
        habitName: String(form.habitName || ""),
        frequency: form.frequency as "Daily" | "Weekly",
        streak: Number(form.streak || 0),
        completed: Boolean(form.completed)
      } as DraftByMode[M];
    case "study":
      return {
        subject: String(form.subject || ""),
        topic: String(form.topic || ""),
        estimatedStudyTime: String(form.estimatedStudyTime || ""),
        completed: Boolean(form.completed)
      } as DraftByMode[M];
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
  const initial = useMemo(
    () => (editingItem ? { ...defaults[mode], ...editingItem } : defaults[mode]),
    [editingItem, mode]
  );
  const [form, setForm] = useState<FormState>(initial);

  useEffect(() => {
    setForm(initial);
  }, [initial]);

  const setValue = (key: string, value: string | number | boolean) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
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
            <form className="mt-4 space-y-3" onSubmit={submit}>
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
          <div className="grid grid-cols-2 gap-3">
            <OptionPills
              value={String(form.priority || "Medium")}
              options={["Low", "Medium", "High"]}
              onChange={(value) => setValue("priority", value)}
            />
            <input
              type="date"
              className={inputBaseClass}
              value={String(form.dueDate || "")}
              onChange={(e) => setValue("dueDate", e.target.value)}
            />
          </div>
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
              min={1}
              className={inputBaseClass}
              placeholder="Quantity"
              value={Number(form.quantity || 1)}
              onChange={(e) => setValue("quantity", Number(e.target.value))}
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
          <input
            className={inputBaseClass}
            placeholder="Estimated Study Time (e.g. 45 min)"
            value={String(form.estimatedStudyTime || "")}
            onChange={(e) => setValue("estimatedStudyTime", e.target.value)}
          />
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
