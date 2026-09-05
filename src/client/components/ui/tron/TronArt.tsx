import React from 'react';

/**
 * The chrome, as the hand-drawn artwork itself.
 *
 * Every path below is copied verbatim out of `stonefallchrome.svg`, transforms included. Nothing
 * here is regenerated, approximated or re-derived.
 *
 * The previous three attempts all made the same mistake in different clothes: they built a
 * parametric frame generator and then tuned its constants to converge on the drawing. That can
 * only ever approach the artwork asymptotically, and every round of tuning was me judging my own
 * approximation rather than using the thing I had been given. The drawing is the specification.
 *
 * What pushed me into generating was that these elements have to resize around variable content
 * -- a score can be three digits or six -- and a hand-drawn path is a fixed shape. That is a real
 * constraint but a bad reason: the frames are drawn large and mostly empty, so short content fits
 * inside them comfortably. Each shape therefore scales uniformly at its own aspect ratio, and its
 * content sits in a safe box measured inside the artwork's own outline.
 *
 * Strokes use `vector-effect: non-scaling-stroke`, so a shape drawn at 1px in a 1024-wide artboard
 * still renders at 1px however far it is scaled down. Without it the lines vanish at UI sizes.
 */

const STROKE = 'rgb(10,158,198)';

interface ShapeProps {
  className?: string;
  /** Native tooltip, so a chip showing only an icon and a number can still say what it is. */
  title?: string;
  children?: React.ReactNode;
}

/**
 * Wraps a piece of the artwork so it scales uniformly and holds content.
 *
 * `preserveAspectRatio` is left at its default: the shapes must never be stretched, which is what
 * made an earlier attempt turn 45-degree chamfers into whatever angle the element's proportions
 * happened to imply.
 */
const Art: React.FC<
  ShapeProps & {
    viewBox: string;
    /** Safe area for content, as percentages measured inside the drawn outline. */
    inset: { top: string; right: string; bottom: string; left: string };
    paths: React.ReactNode;
  }
> = ({ viewBox, inset, paths, className = '', title, children }) => (
  <div className={`tron-art ${className}`} title={title}>
    <svg
      className="tron-art__svg"
      viewBox={viewBox}
      fill="none"
      stroke={STROKE}
      strokeMiterlimit={1.5}
      aria-hidden="true"
      focusable="false"
    >
      {paths}
    </svg>
    <div
      className="tron-art__content"
      style={{ top: inset.top, right: inset.right, bottom: inset.bottom, left: inset.left }}
    >
      {children}
    </div>
  </div>
);

/**
 * The headline panel: deep chamfer at the top left, a long sweep closing the right end, a bottom
 * edge that steps up on its way there, and the hatch and tick detailing along the left side.
 */
export const ArtPanel: React.FC<ShapeProps> = (props) => (
  <Art
    {...props}
    viewBox="43 34 720 162"
    inset={{ top: '14%', right: '20%', bottom: '17%', left: '10%' }}
    paths={
      <>
        <path
          className="tron-art__shape"
          d="M99,35.787L44.653,90.347L44.653,174L64.231,193.578L127,193.578L132.331,188.247L351,188.247L357.96,181.287L572,181.287L582.958,170.329L635,170.329L760.015,45.314L750.487,35.787L99,35.787Z"
          strokeWidth={1}
          strokeLinecap="square"
          vectorEffect="non-scaling-stroke"
        />
        {/* Hatch bars down the left edge. */}
        {[0, 10.72, 21.27].map((dy) => (
          <path
            key={`tick${dy}`}
            d="M57,143L57,147"
            strokeWidth={1}
            transform={`translate(0 ${dy})`}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {[-2, 9.458, 19.419, 30.877].map((dy) => (
          <path
            key={`bar${dy}`}
            d="M78.025,77.975L77.958,82.042L58,102L58,98L78.025,77.975Z"
            fill={STROKE}
            stroke="none"
            transform={`translate(-1 ${dy})`}
          />
        ))}
        {/* Hatch group along the bottom left. */}
        {[50.163, 62.733, 74.459, 86.681].map((dx) => (
          <path
            key={`hatch${dx}`}
            d="M58,98L78.025,77.975L91.921,77.975L71.849,98.047L58,98Z"
            fill={STROKE}
            stroke="none"
            transform={`matrix(0.400747,0,0,0.400747,${dx},144.689339)`}
          />
        ))}
      </>
    }
  />
);

/** The pill used for a single stat, with its column of three squares. */
export const ArtChip: React.FC<ShapeProps> = (props) => (
  <Art
    {...props}
    viewBox="44 229 204 70"
    inset={{ top: '14%', right: '16%', bottom: '14%', left: '12%' }}
    paths={
      <>
        <path
          className="tron-art__shape"
          d="M46,228L29.752,244.248L29.752,282L43.023,295.271L218,295.271L231.503,281.768L231.503,244L214.493,227.99L46,228Z"
          strokeWidth={1}
          strokeLinecap="square"
          transform="translate(15.327767 2)"
          vectorEffect="non-scaling-stroke"
        />
        {[0, 10.55, 21.1].map((dy) => (
          <rect
            key={dy}
            x={229}
            y={248}
            width={3}
            height={3}
            fill={STROKE}
            stroke="none"
            transform={`translate(0 ${3.581 + dy})`}
          />
        ))}
      </>
    }
  />
);

/** Primary action: the double-outlined button, with the stepped jog on its inner line. */
export const ArtButton: React.FC<ShapeProps> = (props) => (
  <Art
    {...props}
    viewBox="43 332 533 112"
    inset={{ top: '18%', right: '12%', bottom: '18%', left: '12%' }}
    paths={
      <>
        <path
          className="tron-art__shape"
          d="M75,335L45.174,364.826L45.174,422L64.656,441.482L540,441.482L573.787,407.695L573.787,356L552.137,334.35L75,335Z"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        <path
          d="M528.505,433.232L563.737,398L563.737,359.737L547,343L82,343L55.726,369.274L55.726,419L70.258,433.532L520,433.532L533.106,420.426L533.106,394L558.778,368.328"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      </>
    }
  />
);

/** Secondary action: the quieter double-outlined button. */
export const ArtButtonGhost: React.FC<ShapeProps> = (props) => (
  <Art
    {...props}
    viewBox="602 345 378 87"
    inset={{ top: '20%', right: '10%', bottom: '20%', left: '10%' }}
    paths={
      <>
        <path
          className="tron-art__shape"
          d="M7,228L-9.248,244.248L-9.248,282L4.023,295.271L283.007,295.271L296.51,281.768L296.51,244L279.5,227.99L7,228Z"
          strokeWidth={0.82}
          strokeLinecap="square"
          transform="matrix(1.221757,0,0,1.221757,614.868722,68.582126)"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d="M7,228L-9.248,244.248L-9.248,275.709L4.023,288.98L297.386,288.98L310.888,275.477L310.888,244L293.879,227.99L7,228Z"
          strokeWidth={0.9}
          strokeLinecap="square"
          transform="matrix(1.11276,0,0,1.11276,623.860686,99.665476)"
          vectorEffect="non-scaling-stroke"
        />
      </>
    }
  />
);

/** Square icon button. */
export const ArtIconButton: React.FC<ShapeProps> = (props) => (
  <Art
    {...props}
    viewBox="53 494 92 86"
    inset={{ top: '18%', right: '18%', bottom: '18%', left: '18%' }}
    paths={
      <path
        className="tron-art__shape"
        d="M47,502L60.217,488.783L141,488.783L151.046,498.829L151.046,570L135.7,585.346L59,585.346L47.087,574.433L47,502Z"
        strokeWidth={1.18}
        transform="matrix(0.846222,0,0,0.846222,15.227585,82.588956)"
        vectorEffect="non-scaling-stroke"
      />
    }
  />
);

/**
 * The two-option switch: two shapes with facing 45-degree edges and a dark gap between them, the
 * active one filled solid.
 *
 * Drawn as one artwork with both halves, because the halves are cut to lean toward each other and
 * only make sense as a pair. Which half is filled swaps with the selection.
 */
export const ArtSwitch: React.FC<{
  options: ReadonlyArray<{ value: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  disabled?: boolean | undefined;
}> = ({ options, value, onChange, ariaLabel, disabled }) => {
  const activeIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value)
  );

  const left =
    'M712,238L699.16,250.84L699.16,278L711.943,290.782L813,290.782L841.696,262.087L841.696,238L712,238Z';
  const right =
    'M849,238L849,266L823.709,291.291L957,291.291L970.855,277.437L970.855,252L956.706,237.851L849,238Z';

  return (
    <div className="tron-art tron-switch" role="radiogroup" aria-label={ariaLabel}>
      <svg
        className="tron-art__svg"
        viewBox="697 236 276 58"
        fill="none"
        stroke={STROKE}
        strokeMiterlimit={1.5}
        aria-hidden="true"
        focusable="false"
      >
        <path
          d={left}
          fill={activeIndex === 0 ? STROKE : 'rgba(2,16,26,0.82)'}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={right}
          fill={activeIndex === 1 ? STROKE : 'rgba(2,16,26,0.82)'}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="tron-switch__row">
        {options.map((option, i) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={i === activeIndex}
            disabled={disabled}
            className={`tron-switch__seg${i === activeIndex ? ' tron-switch__seg--on' : ''}`}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
};

/**
 * Icons.
 *
 * These are the one part not in the traced file, so they are drawn to sit with it: same 1px
 * weight, same stroke-only treatment, no fills.
 */
const Icon: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <svg
    className="tron-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {children}
  </svg>
);

export const ZoomInIcon = () => (
  <Icon>
    <circle cx={10.5} cy={10.5} r={6.5} />
    <path d="M15.5 15.5 21 21M10.5 7.5v6M7.5 10.5h6" />
  </Icon>
);

export const ZoomOutIcon = () => (
  <Icon>
    <circle cx={10.5} cy={10.5} r={6.5} />
    <path d="M15.5 15.5 21 21M7.5 10.5h6" />
  </Icon>
);

export const RotateLeftIcon = () => (
  <Icon>
    <path d="M4 5v5h5" />
    <path d="M4.5 10a8 8 0 1 1 1.2 7" />
  </Icon>
);

export const RotateRightIcon = () => (
  <Icon>
    <path d="M20 5v5h-5" />
    <path d="M19.5 10a8 8 0 1 0-1.2 7" />
  </Icon>
);

export const BlocksIcon = () => (
  <Icon>
    <path d="M12 3 21 7.5 12 12 3 7.5 12 3Z" />
    <path d="M3 12 12 16.5 21 12M3 16.5 12 21l9-4.5" />
  </Icon>
);

export const HeightIcon = () => (
  <Icon>
    <path d="M12 3.5v17M8.5 4.5h7M10 9h4M10 15h4M8.5 19.5h7" />
  </Icon>
);

/** A perfect placement: a four-point spark. */
export const SparkIcon = () => (
  <Icon>
    <path d="M12 3v6M12 15v6M3 12h6M15 12h6" />
    <path d="M12 8.5 13.6 12 12 15.5 10.4 12 12 8.5Z" />
  </Icon>
);

/** One tower standing on another. */
export const StackIcon = () => (
  <Icon>
    <rect x={7} y={13} width={10} height={7} />
    <rect x={9} y={4} width={6} height={9} />
  </Icon>
);

/** Builders. */
export const UsersIcon = () => (
  <Icon>
    <circle cx={9} cy={8} r={3.2} />
    <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
    <circle cx={16.5} cy={9} r={2.4} />
    <path d="M15.5 14.2a4.5 4.5 0 0 1 5 4.3" />
  </Icon>
);

export const CloseIcon = () => (
  <Icon>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
);
