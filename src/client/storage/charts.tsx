import React, { useLayoutEffect, useRef, useState } from 'react';
import type { StorageHistoryPoint, StorageRelease } from '../../shared/types/storage';
import { GROUPS, bytes, colorOf, groupOf, shortDay, share, type Group } from './format';

/**
 * The dashboard's charts, drawn by hand in SVG: the page carries no chart library.
 *
 * Marks are thin, data ends are rounded and sit on the baseline, filled marks keep a 2px gap of
 * surface between them, and every mark answers a hover or a tap with its numbers, so nothing is
 * told by colour alone. Text is ink, never the series colour.
 */

/** A container's width, kept as it resizes, so the SVG is drawn in real pixels. */
const useWidth = (): [React.RefObject<HTMLDivElement | null>, number] => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(el.getBoundingClientRect().width);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
};

/** A label over the chart at x, the mark's own numbers. */
const Tip: React.FC<{ x: number; width: number; children: React.ReactNode }> = ({
  x,
  width,
  children,
}) => (
  <div
    className="sd-tip"
    role="status"
    style={{ left: Math.max(0, Math.min(width - 168, x - 84)) }}
  >
    {children}
  </div>
);

/** The fill for what the report cannot see: the alert colour, hatched, never a series colour. */
const Hatch: React.FC<{ id: string }> = ({ id }) => (
  <pattern id={id} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
    <rect width="6" height="6" fill="rgba(255,138,138,0.16)" />
    <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(255,138,138,0.85)" strokeWidth="2" />
  </pattern>
);

export interface UsageSlice {
  group: Group;
  bytes: number;
}

/**
 * The limit as one bar: what the report saw, by group, and when writes are blocked for the quota,
 * the part it could not see, hatched, filling the rest. Without a block the rest is empty track.
 */
export const UsageBar: React.FC<{
  slices: readonly UsageSlice[];
  unseen: number;
  limit: number;
}> = ({ slices, unseen, limit }) => {
  const [ref, width] = useWidth();
  const [tip, setTip] = useState<{ x: number; label: string; value: number } | null>(null);
  const seen = slices.reduce((n, s) => n + s.bytes, 0);
  const scale = Math.max(limit, seen + unseen);
  const H = 16;
  const GAP = 2;
  let x = 0;
  const marks: Array<{ x: number; w: number; fill: string; label: string; value: number }> = [];
  for (const s of [...slices].filter((s) => s.bytes > 0)) {
    const w = (s.bytes / scale) * width;
    marks.push({
      x,
      w,
      fill: colorOf(s.group),
      label: GROUPS.find((g) => g.id === s.group)!.label,
      value: s.bytes,
    });
    x += w;
  }
  if (unseen > 0) {
    marks.push({
      x,
      w: (unseen / scale) * width,
      fill: 'url(#sd-hatch)',
      label: 'Unseen',
      value: unseen,
    });
  }
  return (
    <div ref={ref} className="sd-chart sd-usage" onPointerLeave={() => setTip(null)}>
      {width > 0 && (
        <svg width={width} height={H} role="img" aria-label="Storage used, by group">
          <defs>
            <Hatch id="sd-hatch" />
            <clipPath id="sd-usage-clip">
              <rect width={width} height={H} rx={4} />
            </clipPath>
          </defs>
          <rect width={width} height={H} rx={4} fill="rgba(243,247,250,0.07)" />
          <g clipPath="url(#sd-usage-clip)">
            {marks.map((m, i) => (
              <rect
                key={m.label}
                x={m.x}
                y={0}
                width={Math.max(0, m.w - (i < marks.length - 1 ? GAP : 0))}
                height={H}
                fill={m.fill}
                onPointerEnter={() => setTip({ x: m.x + m.w / 2, label: m.label, value: m.value })}
                onClick={() => setTip({ x: m.x + m.w / 2, label: m.label, value: m.value })}
              />
            ))}
          </g>
        </svg>
      )}
      {tip && (
        <Tip x={tip.x} width={width}>
          <b>{tip.label}</b> {bytes(tip.value)} · {share(tip.value, limit)} of the limit
        </Tip>
      )}
    </div>
  );
};

/** One row's share as a thin bar, for lists ranked by size. */
export const RankBar: React.FC<{ value: number; max: number; color: string }> = ({
  value,
  max,
  color,
}) => (
  <span className="sd-rank" aria-hidden="true">
    <span
      className="sd-rank__fill"
      style={{ width: `${max > 0 ? Math.max(1.5, (100 * value) / max) : 0}%`, background: color }}
    />
  </span>
);

const DAY_MS = 86_400_000;
const dayMs = (day: string): number => Date.parse(`${day}T00:00:00Z`);

/**
 * Storage seen over the days the history holds, against the limit. One series, so no legend: the
 * heading names it. A crosshair follows the pointer to the nearest day.
 */
export const TrendChart: React.FC<{
  points: readonly StorageHistoryPoint[];
  limit: number;
  blocked: boolean;
  /** What the latest point could not see, hatched above it up to the limit. */
  unseen?: number;
}> = ({ points, limit, blocked, unseen = 0 }) => {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const H = 150;
  const PAD = { top: 14, right: 8, bottom: 20, left: 40 };
  if (points.length < 2) {
    return (
      <p className="sd-empty">
        The trend needs two days of history. The daily snapshot keeps one a day
        {blocked ? ', and cannot while writes are blocked' : ''}.
      </p>
    );
  }
  const x0 = dayMs(points[0]!.day);
  const x1 = Math.max(x0 + DAY_MS, dayMs(points[points.length - 1]!.day));
  const yMax = Math.max(limit, ...points.map((p) => p.bytes)) * 1.04;
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = H - PAD.top - PAD.bottom;
  const px = (day: string) => PAD.left + ((dayMs(day) - x0) / (x1 - x0)) * plotW;
  const py = (b: number) => PAD.top + plotH - (b / yMax) * plotH;
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${px(p.day)},${py(p.bytes)}`).join('');
  const area = `${line}L${px(points[points.length - 1]!.day)},${py(0)}L${px(points[0]!.day)},${py(0)}Z`;
  const ticks = [0, limit / 2, limit];
  const near = (clientX: number, box: DOMRect) => {
    const at = clientX - box.left;
    let best = 0;
    points.forEach((p, i) => {
      if (Math.abs(px(p.day) - at) < Math.abs(px(points[best]!.day) - at)) best = i;
    });
    setHover(best);
  };
  const h = hover === null ? null : points[hover]!;
  return (
    <div
      ref={ref}
      className="sd-chart"
      onPointerMove={(e) => near(e.clientX, e.currentTarget.getBoundingClientRect())}
      onPointerDown={(e) => near(e.clientX, e.currentTarget.getBoundingClientRect())}
      onPointerLeave={() => setHover(null)}
    >
      {width > 0 && (
        <svg
          width={width}
          height={H}
          role="img"
          aria-label="Storage seen per day, against the limit"
        >
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={width - PAD.right}
                y1={py(t)}
                y2={py(t)}
                className="sd-grid"
              />
              <text x={PAD.left - 6} y={py(t) + 4} className="sd-axis" textAnchor="end">
                {t === 0 ? '0' : bytes(t)}
              </text>
            </g>
          ))}
          <line
            x1={PAD.left}
            x2={width - PAD.right}
            y1={py(limit)}
            y2={py(limit)}
            className="sd-limit"
          />
          <text
            x={width - PAD.right}
            y={py(limit) - 5}
            className="sd-axis sd-axis--alert"
            textAnchor="end"
          >
            {blocked ? 'Limit · writes blocked' : 'Limit'}
          </text>
          <path d={area} fill="rgba(79,242,255,0.10)" />
          <defs>
            <Hatch id="sd-hatch-trend" />
          </defs>
          {unseen > 0 && (
            <rect
              x={px(points[points.length - 1]!.day) - 4}
              y={py(points[points.length - 1]!.bytes + unseen)}
              width={8}
              height={Math.max(
                0,
                py(points[points.length - 1]!.bytes) -
                  py(points[points.length - 1]!.bytes + unseen) -
                  2
              )}
              rx={2}
              fill="url(#sd-hatch-trend)"
            />
          )}
          <path d={line} fill="none" stroke="#4ff2ff" strokeWidth={2} strokeLinejoin="round" />
          <text x={PAD.left} y={H - 4} className="sd-axis">
            {shortDay(points[0]!.day)}
          </text>
          <text x={width - PAD.right} y={H - 4} className="sd-axis" textAnchor="end">
            {shortDay(points[points.length - 1]!.day)}
          </text>
          {h && (
            <g>
              <line x1={px(h.day)} x2={px(h.day)} y1={PAD.top} y2={py(0)} className="sd-cross" />
              <circle
                cx={px(h.day)}
                cy={py(h.bytes)}
                r={4.5}
                fill="#4ff2ff"
                stroke="#000814"
                strokeWidth={2}
              />
            </g>
          )}
        </svg>
      )}
      {h && (
        <Tip x={px(h.day)} width={width}>
          <b>{shortDay(h.day)}</b> {bytes(h.bytes)} seen
          {hover === points.length - 1 && unseen > 0 ? `, at least ${bytes(unseen)} unseen` : ''}
          {h.players > 0 ? ` · ${h.players.toLocaleString('en-US')} players a day` : ''}
        </Tip>
      )}
    </div>
  );
};

/**
 * What expires on each coming day, stacked by group: what Redis gives back by itself if nothing
 * new is written. Groups stack in the legend's order, so a colour is always in the same place.
 */
export const ReleaseChart: React.FC<{ releases: readonly StorageRelease[] }> = ({ releases }) => {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const H = 132;
  const PAD = { top: 8, right: 4, bottom: 20, left: 4 };
  const byGroup = releases.map((r) => {
    const g: Record<Group, number> = { runs: 0, players: 0, maps: 0, relay: 0, other: 0 };
    for (const [f, b] of Object.entries(r.byFamily)) g[groupOf(f as never)] += b ?? 0;
    return g;
  });
  const yMax = Math.max(1, ...releases.map((r) => r.bytes));
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = H - PAD.top - PAD.bottom;
  const band = releases.length > 0 ? plotW / releases.length : 0;
  const barW = Math.max(1, band - 2);
  const pick = (clientX: number, box: DOMRect) => {
    const i = Math.floor((clientX - box.left - PAD.left) / Math.max(1, band));
    setHover(i >= 0 && i < releases.length ? i : null);
  };
  const h = hover === null ? null : releases[hover]!;
  return (
    <div
      ref={ref}
      className="sd-chart"
      onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
      onPointerDown={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
      onPointerLeave={() => setHover(null)}
    >
      {width > 0 && (
        <svg
          width={width}
          height={H}
          role="img"
          aria-label="Bytes expiring on each of the next days"
        >
          <line
            x1={PAD.left}
            x2={width - PAD.right}
            y1={PAD.top + plotH}
            y2={PAD.top + plotH}
            className="sd-grid"
          />
          {releases.map((r, i) => {
            let y = PAD.top + plotH;
            const parts = GROUPS.filter((g) => byGroup[i]![g.id] > 0);
            return (
              <g key={r.day} opacity={hover === null || hover === i ? 1 : 0.45}>
                {parts.map((g, j) => {
                  const hgt = (byGroup[i]![g.id] / yMax) * plotH;
                  const gap = j < parts.length - 1 && hgt > 3 ? 2 : 0;
                  y -= hgt;
                  const top = j === parts.length - 1;
                  return top ? (
                    <path
                      key={g.id}
                      d={roundTop(
                        PAD.left + i * band + 1,
                        y,
                        barW,
                        hgt,
                        Math.min(3, barW / 2, hgt)
                      )}
                      fill={g.color}
                    />
                  ) : (
                    <rect
                      key={g.id}
                      x={PAD.left + i * band + 1}
                      y={y + gap}
                      width={barW}
                      height={Math.max(0, hgt - gap)}
                      fill={g.color}
                    />
                  );
                })}
              </g>
            );
          })}
          <text x={PAD.left} y={H - 4} className="sd-axis">
            Today
          </text>
          {releases.length > 14 && (
            <text
              x={PAD.left + 14 * band + band / 2}
              y={H - 4}
              className="sd-axis"
              textAnchor="middle"
            >
              {shortDay(releases[14]!.day)}
            </text>
          )}
          <text x={width - PAD.right} y={H - 4} className="sd-axis" textAnchor="end">
            {shortDay(releases[releases.length - 1]?.day ?? '')}
          </text>
        </svg>
      )}
      {h && (
        <Tip x={PAD.left + (hover! + 0.5) * band} width={width}>
          <b>{hover === 0 ? 'Today' : shortDay(h.day)}</b> {bytes(h.bytes)} expires
          {GROUPS.filter((g) => byGroup[hover!]![g.id] > 0).map((g) => (
            <span key={g.id} className="sd-tip__row">
              <i style={{ background: g.color }} />
              {g.label} {bytes(byGroup[hover!]![g.id])}
            </span>
          ))}
        </Tip>
      )}
    </div>
  );
};

/** A bar rounded at its top only, so its data end is rounded and its foot sits on the baseline. */
const roundTop = (x: number, y: number, w: number, h: number, r: number): string =>
  h <= 0
    ? ''
    : `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
