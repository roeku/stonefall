/**
 * Whether the post can be seen: the page is showing, and the post is on screen rather than
 * scrolled away in the feed.
 *
 * Devvit asks for a game's sound to stop when the player scrolls away. The page's own visibility
 * only changes when the tab or app is backgrounded, so the frame's place in the viewport is
 * watched too: an IntersectionObserver with no root measures the frame against the top-level
 * viewport, even across the origin boundary of Reddit's iframe.
 *
 * A post counts as gone once less than a quarter of it shows: a sliver at the edge of the screen
 * is not something the player is looking at.
 */
export const watchPostVisibility = (onChange: (visible: boolean) => void): (() => void) => {
  let pageShowing = document.visibilityState === 'visible';
  let onScreen = true;
  let last: boolean | null = null;
  const emit = () => {
    const visible = pageShowing && onScreen;
    if (visible === last) return;
    last = visible;
    onChange(visible);
  };

  const onVisibility = () => {
    pageShowing = document.visibilityState === 'visible';
    emit();
  };
  document.addEventListener('visibilitychange', onVisibility);

  let observer: IntersectionObserver | null = null;
  if (typeof IntersectionObserver !== 'undefined') {
    observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (!entry) return;
        onScreen = entry.isIntersecting && entry.intersectionRatio >= 0.25;
        emit();
      },
      { threshold: [0, 0.25, 0.5] }
    );
    observer.observe(document.documentElement);
  }
  emit();

  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    observer?.disconnect();
  };
};
