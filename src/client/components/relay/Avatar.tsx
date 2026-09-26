import React from 'react';

/**
 * A player's face: their Reddit avatar, or their initial when they have none or it will not load.
 *
 * The fallback used to be the Snoo picture from Devvit's template. Snoo is Reddit's mascot, and
 * the Devvit Rules forbid Reddit's trademarks and brand assets in an app, so a player without an
 * avatar is now the first letter of their name, set in their colour by the ring around it.
 */
export const Avatar: React.FC<{ src: string | null; name: string; className?: string }> = ({
  src,
  name,
  className = '',
}) => {
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), [src]);
  if (src && !failed) {
    return (
      <img
        className={className}
        src={src}
        alt=""
        draggable={false}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span className={`${className} avatar-initial`} aria-hidden="true">
      {(name.trim()[0] ?? '?').toUpperCase()}
    </span>
  );
};
