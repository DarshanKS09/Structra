"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

/**
 * Small trend charts.
 *
 * ---------------------------------------------------------------------------
 * WHY THESE EXIST
 * ---------------------------------------------------------------------------
 * Each one answers exactly one question, because a chart that answers none is
 * decoration:
 *
 *   TrendBars   "how much did I get done each day?"
 *   TrendLine   "how much time did I spend each day?"
 *
 * A bar chart suits the first because the values are independent counts and gaps
 * between days are meaningful; a line suits the second because time accumulates
 * smoothly and the shape of the trend is the point.
 *
 * ---------------------------------------------------------------------------
 * RESPONSIVE
 * ---------------------------------------------------------------------------
 * `ResponsiveContainer` measures the parent, and the explicit `height` prop is
 * what stops the chart collapsing to zero. `minTickGap` stops a 30-day axis from
 * drawing 30 unreadable overlapping labels on a phone.
 */

const TOOLTIP_STYLE = {
  background: "rgba(15, 23, 42, 0.95)",
  border: "1px solid rgba(148, 163, 184, 0.3)",
  borderRadius: "0.75rem",
  fontSize: "0.75rem",
  color: "#e2e8f0"
};

type Point = { label: string; value: number };

type BarProps = {
  data: Point[];
  formatValue?: (value: number) => string;
  height?: number;
  /** Chart title, also used as the accessible description. */
  title: string;
  color?: string;
};

/** `2026-10-08` -> `8 Oct`, without pulling in a date library. */
const shortDay = (label: string): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(label);
  if (!match) return label;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(match[3])} ${months[Number(match[2]) - 1] ?? ""}`;
};

const useChartData = (data: Point[]) =>
  useMemo(() => data.map((point) => ({ ...point, label: shortDay(point.label) })), [data]);

export function TrendBars({
  data,
  formatValue = (v) => `${v}`,
  height = 180,
  title,
  color = "#38bdf8"
}: BarProps) {
  const chartData = useChartData(data);

  if (chartData.length === 0) {
    return <EmptyTrend height={height} />;
  }

  return (
    <div style={{ height }} role="img" aria-label={title}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: "rgba(148,163,184,0.9)" }}
            axisLine={false}
            tickLine={false}
            minTickGap={12}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 10, fill: "rgba(148,163,184,0.9)" }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
            width={44}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={{ color: "#e2e8f0" }}
            itemStyle={{ color: "#e2e8f0" }}
            cursor={{ fill: "rgba(148,163,184,0.12)" }}
            formatter={(value: number) => [formatValue(value), ""]}
          />
          <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function TrendLine({
  data,
  formatValue = (v) => `${v}`,
  height = 180,
  title,
  color = "#a78bfa"
}: BarProps) {
  const chartData = useChartData(data);

  if (chartData.length === 0) {
    return <EmptyTrend height={height} />;
  }

  return (
    <div style={{ height }} role="img" aria-label={title}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: "rgba(148,163,184,0.9)" }}
            axisLine={false}
            tickLine={false}
            minTickGap={12}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 10, fill: "rgba(148,163,184,0.9)" }}
            axisLine={false}
            tickLine={false}
            width={52}
            tickFormatter={(v) => formatValue(Number(v))}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={{ color: "#e2e8f0" }}
            itemStyle={{ color: "#e2e8f0" }}
            formatter={(value: number) => [formatValue(value), ""]}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** A named breakdown rendered as horizontal bars, for priority/category mixes. */
export function BreakdownBars({
  items,
  formatValue = (v) => `${v}`,
  title
}: {
  items: { label: string; count: number }[];
  formatValue?: (value: number) => string;
  title: string;
}) {
  const max = items.reduce((highest, item) => Math.max(highest, item.count), 0);

  if (items.length === 0) {
    return (
      <p className="py-4 text-center text-xs text-slate-400 light:text-slate-500">
        Nothing recorded yet.
      </p>
    );
  }

  return (
    <ul className="space-y-2.5" aria-label={title}>
      {items.map((item, index) => {
        const pct = max === 0 ? 0 : Math.round((item.count / max) * 100);
        const color = FALLBACK[index % FALLBACK.length];
        return (
          <li key={item.label}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
              <span className="min-w-0 truncate" title={item.label}>
                {item.label}
              </span>
              <span className="shrink-0 font-semibold tabular-nums">{formatValue(item.count)}</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10 light:bg-slate-200">
              <div
                className="h-full rounded-full"
                style={{ width: `${Math.max(pct, item.count > 0 ? 4 : 0)}%`, background: color }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

const FALLBACK = ["#38bdf8", "#a78bfa", "#34d399", "#fbbf24", "#fb7185", "#22d3ee"];

function EmptyTrend({ height }: { height: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-xl border border-dashed border-white/20 text-xs text-slate-400 light:text-slate-500"
      style={{ height }}
    >
      No activity in this period
    </div>
  );
}