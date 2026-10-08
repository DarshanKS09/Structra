"use client";

import { useMemo } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

/**
 * A small donut chart.
 *
 * ---------------------------------------------------------------------------
 * WHY RECHARTS
 * ---------------------------------------------------------------------------
 * The audit found no charting library in the project. Building a donut by hand
 * means hand-rolling arc maths, responsive measurement and accessibility - which
 * is exactly the kind of bespoke chart engine worth not writing. Recharts is the
 * standard React choice, renders through SVG (so it scales and is inspectable),
 * and carries no imperative canvas layer.
 *
 * ---------------------------------------------------------------------------
 * WHY ONE DONUT INSTEAD OF SEVERAL PIES
 * ---------------------------------------------------------------------------
 * A pie per subject needs one chart per subject and cannot be read as a whole.
 * A single donut with a legend answers "where does my time go, and which slice is
 * biggest" in one glance, which is the question the analytics exists to answer.
 *
 * ---------------------------------------------------------------------------
 * EMPTY STATE
 * ---------------------------------------------------------------------------
 * A donut of zero total is meaningless - every slice would be 0% and the ring
 * would be empty - so it renders an explicit message rather than an empty circle
 * that looks broken.
 */

/** One slice. `value` may be any unit; only its proportion is drawn. */
export type DonutSlice = {
  key: string;
  label: string;
  value: number;
  /** Explicit colour. Falls back to the palette by index when absent. */
  color?: string;
};

/**
 * Slices are colour-coded by MEANING, not by series identity: completed is
 * always green, pending always the accent, overdue always red. A user learns
 * that once and it still holds on a different screen.
 */
const SEMANTIC_COLORS: Record<string, string> = {
  completed: "#34d399",
  pending: "#38bdf8",
  overdue: "#fb7185",
  cancelled: "#94a3b8"
};

const FALLBACK_PALETTE = [
  "#38bdf8", "#a78bfa", "#34d399", "#fbbf24", "#fb7185", "#22d3ee", "#f472b6", "#a3e635"
];

const humanise = (value: number): string => {
  // Compact enough for a tooltip without a formatting dependency.
  if (value === 0) return "0";
  if (Math.abs(value) < 1000) return `${Math.round(value * 100) / 100}`;
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);
};

type Props = {
  slices: DonutSlice[];
  /** Shown in the middle of the ring. */
  centerLabel?: string;
  centerValue?: string;
  /** Accessible description of what the chart shows. */
  title: string;
  size?: number;
  /** Renders a legend beside the donut. Off for very compact cards. */
  showLegend?: boolean;
  /** Formats tooltip and legend numbers, e.g. seconds -> "3h 20m". */
  formatValue?: (value: number) => string;
};

export function DonutChart({
  slices,
  centerLabel,
  centerValue,
  title,
  size = 168,
  showLegend = true,
  formatValue = humanise
}: Props) {
  const data = useMemo(
    () =>
      slices
        .filter((slice) => Number.isFinite(slice.value) && slice.value > 0)
        .map((slice, index) => ({
          ...slice,
          color:
            slice.color ??
            SEMANTIC_COLORS[slice.key.toLowerCase()] ??
            FALLBACK_PALETTE[index % FALLBACK_PALETTE.length]
        })),
    [slices]
  );

  const total = data.reduce((sum, slice) => sum + slice.value, 0);

  if (data.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-1 text-center"
        style={{ minHeight: size * 0.6 }}
        role="img"
        aria-label={title}
      >
        <div
          className="rounded-full border-2 border-dashed border-white/25"
          style={{ width: size * 0.42, height: size * 0.42 }}
        />
        <p className="text-xs text-slate-400 light:text-slate-500">No data yet</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-center sm:gap-4">
      <div
        className="relative shrink-0"
        style={{ width: size, height: size }}
        role="img"
        aria-label={`${title}. ${data
          .map((slice) => `${slice.label}: ${formatValue(slice.value)}`)
          .join(", ")}`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="label"
              innerRadius="62%"
              outerRadius="92%"
              // A small gap between slices reads as separate segments rather
              // than one continuous ring.
              paddingAngle={2}
              stroke="none"
              isAnimationActive={false}
            >
              {data.map((slice) => (
                <Cell key={slice.key} fill={slice.color} />
              ))}
            </Pie>
            <Tooltip
              // Recharts renders this content, so it must not inherit the
              // page's light/dark text colour by accident.
              contentStyle={{
                background: "rgba(15, 23, 42, 0.95)",
                border: "1px solid rgba(148, 163, 184, 0.3)",
                borderRadius: "0.75rem",
                fontSize: "0.75rem",
                color: "#e2e8f0"
              }}
              labelStyle={{ color: "#e2e8f0" }}
              itemStyle={{ color: "#e2e8f0" }}
              formatter={(value: number) => formatValue(value)}
            />
          </PieChart>
        </ResponsiveContainer>

        {/*
          The centre is drawn as a sibling rather than as a Pie label, so it can
          hold two lines and stay crisp at any chart size.
        */}
        {(centerValue || centerLabel) && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            {centerValue ? (
              <span className="text-xl font-bold leading-none">{centerValue}</span>
            ) : null}
            {centerLabel ? (
              <span className="mt-1 text-[10px] uppercase tracking-wide text-slate-400">
                {centerLabel}
              </span>
            ) : null}
          </div>
        )}
      </div>

      {showLegend ? (
        <ul className="w-full min-w-0 space-y-1.5 sm:max-w-[13rem]">
          {data.map((slice) => {
            const pct = total === 0 ? 0 : Math.round((slice.value / total) * 100);
            return (
              <li key={slice.key} className="flex items-center gap-2 text-xs">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: slice.color }}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate" title={slice.label}>
                  {slice.label}
                </span>
                <span className="shrink-0 font-semibold tabular-nums">{formatValue(slice.value)}</span>
                <span className="w-9 shrink-0 text-right tabular-nums text-slate-400">
                  {pct}%
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}