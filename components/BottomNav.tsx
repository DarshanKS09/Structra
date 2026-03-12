import { type ListMode, modeLabels } from "@/types/taskTypes";

const modeOrder: ListMode[] = ["task", "grocery", "habit", "study", "fitness", "shopping", "meeting"];

type Props = {
  currentMode: ListMode;
  onChangeMode: (mode: ListMode) => void;
  onBack: () => void;
  isDarkMode: boolean;
  onToggleTheme: () => void;
};

export function BottomNav({ currentMode, onChangeMode, onBack, isDarkMode, onToggleTheme }: Props) {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-white/15 bg-slate-950/85 px-3 pb-4 pt-2 backdrop-blur-xl light:border-slate-300 light:bg-white/90 md:hidden">
      <div className="mb-2 flex items-center justify-between px-1 text-xs text-slate-300 light:text-slate-600">
        <button type="button" onClick={onBack} className="rounded-lg px-2 py-1 hover:bg-white/10">
          Modes
        </button>
        <button type="button" onClick={onToggleTheme} className="rounded-lg px-2 py-1 hover:bg-white/10">
          {isDarkMode ? "Light" : "Dark"}
        </button>
      </div>
      <div className="flex gap-1 overflow-x-auto">
        {modeOrder.map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => onChangeMode(mode)}
            className={`h-11 min-w-fit rounded-xl px-3 text-xs whitespace-nowrap ${
              mode === currentMode
                ? "bg-sky-500 font-semibold text-slate-950"
                : "border border-white/20 text-slate-200 light:border-slate-300 light:text-slate-700"
            }`}
          >
            {modeLabels[mode]}
          </button>
        ))}
      </div>
    </div>
  );
}
