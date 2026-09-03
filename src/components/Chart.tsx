/**
 * The three figures on the stats screen, as SVG.
 *
 * Nothing is decided here: where every mark goes comes out of chart.ts, and this emits
 * shapes. That is the same division the rest of the client keeps, and it is what lets the
 * geometry be tested in Node — a chart whose zero line is in the wrong place looks perfectly
 * fine in a screenshot.
 *
 * **Measured, not scaled.** Each chart is drawn at the width it actually has rather than in a
 * `viewBox` stretched to fit, because a stretched viewBox scales the hairlines and the type
 * along with the geometry: the same chart would come out with 1px rules and 9px labels on a
 * phone and 2.3px rules and 21px labels on a desktop. So the width is observed and the
 * arithmetic redone, which is what `useWidth` is for.
 *
 * **Colour is the game's own grammar and nothing else.** Gilt is what this game means by
 * arriving, so gilt is a round that beat par — below the zero line, since more guesses is
 * higher. Bone is par itself, dim bone is over it. There is no third accent and no palette:
 * blood means letters leaving, which is not a thing a score does.
 *
 * **The length is the mark's shape, not its colour.** Three bands want three ways to be
 * told apart, and three colours would mean inventing two, which would leave gilt meaning
 * "short" on one chart and "beat par" everywhere else. A disc, a square and a diamond — the
 * diamond being the mark the masthead already sets between the two words.
 */

import { memo, useEffect, useState } from 'react';
import {
  histogramChart,
  hintChart,
  scoreChart,
  type Dot,
  type Frame,
} from '../lib/chart';
import { parBuckets, type Completion } from '../lib/stats';

/**
 * The width a chart has been given, once it is on screen.
 *
 * A callback ref rather than a ref object, for the reason `usePlateSize` gives: the element
 * does not exist on the first render, and an effect that reads `ref.current` once on mount
 * finds null and never looks again.
 */
function useWidth(): [(element: HTMLElement | null) => void, number] {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (!element) return;
    const report = (found: number) => {
      if (found > 0) setWidth((was) => (Math.round(was) === Math.round(found) ? was : found));
    };
    report(element.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const rect = entries[entries.length - 1]?.contentRect;
      if (rect) report(rect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  return [setElement, width];
}

/**
 * The room the labels need, in pixels, on every chart here.
 *
 * The top is for the count above the tallest column of the histogram: without it that one
 * label — always the largest number on the chart — sat half off the top of the frame.
 */
const PAD = { left: 26, right: 6, top: 14, bottom: 16 };
const HEIGHT = 132;
const LABEL = 9;

const frameOf = (width: number): Frame => ({ width, height: HEIGHT, pad: PAD });

/** The colour a score is: gilt under par, bone on it, dim bone over it. */
function inkOf(diff: number): string {
  if (diff < 0) return 'var(--color-gilt)';
  return diff === 0 ? 'var(--color-bone)' : 'var(--color-bone-dim)';
}

/** One round: a disc, a square or a diamond, by which of the three lengths it was. */
function Mark({ dot }: { dot: Dot }) {
  const ink = inkOf(dot.diff);
  const r = 3;
  if (dot.band === 1) {
    return <rect x={dot.x - r} y={dot.y - r} width={r * 2} height={r * 2} fill={ink} />;
  }
  if (dot.band === 2) {
    return (
      <path
        d={`M ${dot.x} ${dot.y - r - 0.6} L ${dot.x + r + 0.6} ${dot.y} L ${dot.x} ${
          dot.y + r + 0.6
        } L ${dot.x - r - 0.6} ${dot.y} Z`}
        fill={ink}
      />
    );
  }
  return <circle cx={dot.x} cy={dot.y} r={r} fill={ink} />;
}

/**
 * A chart's frame: the box, and a caption under it.
 *
 * The heading is outside the SVG so it is real text at the page's own size, and the empty
 * case is here rather than in each chart, because "not enough rounds yet" is the same
 * sentence three times over.
 */
function Figure({
  title,
  note,
  children,
  onMeasure,
  empty,
  nothing = 'nothing yet',
}: {
  title: string;
  note?: string | undefined;
  children: React.ReactNode;
  onMeasure: (element: HTMLElement | null) => void;
  empty: boolean;
  /** What to say instead of the figure, when there is no figure. */
  nothing?: string;
}) {
  return (
    <figure className="border-rule bg-noir-2/40 min-w-0 border p-3">
      <figcaption className="label text-ash-lit mb-2 flex flex-wrap items-baseline gap-x-2">
        {title}
        {note && <span className="text-ash normal-case">{note}</span>}
      </figcaption>
      <div ref={onMeasure} className="w-full">
        {empty ? (
          <p className="label text-ash flex items-center" style={{ height: HEIGHT }}>
            {nothing}
          </p>
        ) : (
          children
        )}
      </div>
    </figure>
  );
}

/**
 * Score against par, one mark per round, over the calendar.
 *
 * The zero line is par, and it is the only rule drawn solid: everything on this chart is
 * read against it. The mean is drawn dotted and dim because it is a summary of the marks
 * rather than another fact beside them — with three lengths in one scatter, a run of marks
 * says very little on its own about whether things are going well.
 */
export const ScorePlot = memo(function ScorePlot({
  records,
  bands,
}: {
  records: readonly Completion[];
  bands: readonly string[];
}) {
  const [measure, width] = useWidth();
  const chart = width > 0 ? scoreChart(records, frameOf(width)) : null;

  return (
    <Figure
      title="Vs. Par History"
      note={chart ? `mean ${chart.mean > 0 ? '+' : ''}${chart.mean.toFixed(1)}` : undefined}
      onMeasure={measure}
      empty={records.length === 0}
    >
      {chart && (
        <>
          <svg
            width={width}
            height={HEIGHT}
            role="img"
            aria-label="Guesses against par, one mark per round"
          >
            {chart.ticks.map((tick) => (
              <g key={tick.diff}>
                <line
                  x1={chart.area.left}
                  x2={chart.area.right}
                  y1={tick.y}
                  y2={tick.y}
                  stroke={tick.diff === 0 ? 'var(--color-ash)' : 'var(--color-rule)'}
                />
                <text
                  x={chart.area.left - 5}
                  y={tick.y + 3}
                  textAnchor="end"
                  fontSize={LABEL}
                  fill={tick.diff === 0 ? 'var(--color-bone-dim)' : 'var(--color-ash-lit)'}
                >
                  {tick.label}
                </text>
              </g>
            ))}

            <line
              x1={chart.area.left}
              x2={chart.area.right}
              y1={chart.meanY}
              y2={chart.meanY}
              stroke="var(--color-gilt-dim)"
              strokeDasharray="2 3"
            />

            {chart.dots.map((dot) => (
              <Mark key={dot.key} dot={dot} />
            ))}
          </svg>

          {/* Which shape is which length. Three words, so it sits under the figure. */}
          <p className="label text-ash-lit mt-1 flex flex-wrap gap-x-3 text-[0.55rem]">
            {bands.map((name, band) => (
              <span key={name} className="flex items-center gap-1">
                <svg width={9} height={9} aria-hidden>
                  <Mark dot={{ x: 4.5, y: 4.5, band, diff: 0, date: '', key: name }} />
                </svg>
                {name}
              </span>
            ))}
          </p>
        </>
      )}
    </Figure>
  );
});

/**
 * How the rounds fell against par, as a distribution.
 *
 * Beside the scatter because it answers the same question sooner: five marks spread over a
 * fortnight say very little, and the same five stacked into three columns say "mostly par,
 * once over, never under".
 */
export const ParHistogram = memo(function ParHistogram({
  records,
}: {
  records: readonly Completion[];
}) {
  const [measure, width] = useWidth();
  const buckets = parBuckets(records);
  const chart = width > 0 ? histogramChart(buckets, frameOf(width)) : null;

  return (
    <Figure
      title="Vs. Par Distribution"
      note={chart ? `${records.length} ${records.length === 1 ? 'round' : 'rounds'}` : undefined}
      onMeasure={measure}
      empty={records.length === 0}
    >
      {chart && (
        <svg width={width} height={HEIGHT} role="img" aria-label="How many rounds came in at each score against par">
          <line
            x1={chart.area.left}
            x2={chart.area.right}
            y1={chart.area.bottom}
            y2={chart.area.bottom}
            stroke="var(--color-rule)"
          />
          {chart.bars.map((bar) => (
            <g key={bar.diff}>
              <rect x={bar.x} y={bar.y} width={bar.width} height={bar.height} fill={inkOf(bar.diff)} />
              {bar.count > 0 && (
                <text
                  x={bar.centre}
                  y={bar.y - 3}
                  textAnchor="middle"
                  fontSize={LABEL}
                  fill="var(--color-ash-lit)"
                >
                  {bar.count}
                </text>
              )}
              <text
                x={bar.centre}
                y={chart.area.bottom + 11}
                textAnchor="middle"
                fontSize={LABEL}
                fill={bar.diff === 0 ? 'var(--color-bone-dim)' : 'var(--color-ash-lit)'}
              >
                {bar.diff > 0 ? `+${bar.diff}` : bar.diff}
              </text>
            </g>
          ))}
        </svg>
      )}
    </Figure>
  );
});

/**
 * What each round cost in help, on the same day axis as the scores.
 *
 * Stacked rather than side by side: the first question is what a round cost altogether, and
 * the split between letters and move shapes is the second. Gilt for the shapes, because a
 * move shape is a statement about letters arriving or leaving and gilt is what this game
 * paints an edge with; dim bone for the letters, which are only ever a word.
 */
export const HintPlot = memo(function HintPlot({ records }: { records: readonly Completion[] }) {
  const [measure, width] = useWidth();
  // Nothing bought is nothing to draw, and an axis reading "most 1" over a floor of empty
  // columns says the opposite of the truth about a player who has never asked for help.
  const any = records.some((one) => one.letters + one.shapes > 0);
  const chart = any && width > 0 ? hintChart(records, frameOf(width)) : null;

  return (
    <Figure
      title="Hints per round"
      note={chart ? `most ${chart.most}` : undefined}
      onMeasure={measure}
      empty={!any}
      nothing={records.length === 0 ? 'nothing yet' : 'no hints asked for'}
    >
      {chart && (
        <>
          <svg width={width} height={HEIGHT} role="img" aria-label="Hints bought per round">
            <line
              x1={chart.area.left}
              x2={chart.area.right}
              y1={chart.area.bottom}
              y2={chart.area.bottom}
              stroke="var(--color-rule)"
            />
            {chart.stacks.map((stack) => (
              <g key={stack.key}>
                <rect
                  x={stack.x}
                  y={stack.letters.y}
                  width={stack.width}
                  height={stack.letters.height}
                  fill="var(--color-bone-dim)"
                />
                <rect
                  x={stack.x}
                  y={stack.shapes.y}
                  width={stack.width}
                  height={stack.shapes.height}
                  fill="var(--color-gilt)"
                />
              </g>
            ))}
            <text
              x={chart.area.left - 5}
              y={chart.area.top + 3}
              textAnchor="end"
              fontSize={LABEL}
              fill="var(--color-ash-lit)"
            >
              {chart.most}
            </text>
            <text
              x={chart.area.left - 5}
              y={chart.area.bottom + 3}
              textAnchor="end"
              fontSize={LABEL}
              fill="var(--color-ash-lit)"
            >
              0
            </text>
          </svg>

          <p className="label text-ash-lit mt-1 flex flex-wrap gap-x-3 text-[0.55rem]">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2" style={{ background: 'var(--color-bone-dim)' }} />
              letters
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2" style={{ background: 'var(--color-gilt)' }} />
              move shapes
            </span>
          </p>
        </>
      )}
    </Figure>
  );
});
