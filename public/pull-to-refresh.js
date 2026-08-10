// Standalone/installed PWAs lose the browser's own pull-to-refresh gesture —
// it's chrome-level behavior tied to the address bar, which isn't there once
// the app runs without browser UI. This reimplements just enough of it by
// hand, wired to refreshDashboard() (see app.js) rather than a full page reload.
(function setupPullToRefresh(onRefresh) {
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (!isStandalone) return;

  const THRESHOLD = 70; // px of (resistance-scaled) pull before a release triggers a refresh
  const MAX_PULL = 64; // how far the indicator itself travels, capped short of THRESHOLD on purpose —
  // reaching "ready" should read as an arrival, not a fight against getting further away.
  const RESTING_OFFSET = -44;
  let startY = null;
  let pulling = false;
  let refreshing = false;

  const indicator = document.createElement('div');
  indicator.id = 'ptr-indicator';
  indicator.innerHTML =
    '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M21 12a9 9 0 1 1-2.64-6.36" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M21 3v6h-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  document.body.prepend(indicator);

  function atTop() {
    return (document.scrollingElement || document.documentElement).scrollTop <= 0;
  }

  function setTravel(px, opacity) {
    indicator.style.marginTop = `${RESTING_OFFSET + px}px`;
    indicator.style.opacity = String(opacity);
  }

  document.addEventListener(
    'touchstart',
    (e) => {
      if (refreshing || !atTop()) {
        startY = null;
        return;
      }
      startY = e.touches[0].clientY;
      pulling = true;
    },
    { passive: true }
  );

  document.addEventListener(
    'touchmove',
    (e) => {
      if (!pulling || startY == null) return;
      const delta = e.touches[0].clientY - startY;
      if (delta <= 0 || !atTop()) {
        pulling = false;
        setTravel(0, 0);
        return;
      }
      const travel = Math.min(delta * 0.5, MAX_PULL);
      setTravel(travel, Math.min(travel / MAX_PULL, 1));
      indicator.classList.toggle('ptr-ready', delta >= THRESHOLD);
      if (delta > 10) e.preventDefault(); // only once it's clearly a pull, not a tap/scroll
    },
    { passive: false }
  );

  document.addEventListener(
    'touchend',
    async () => {
      if (!pulling || startY == null) {
        pulling = false;
        startY = null;
        return;
      }
      const wasReady = indicator.classList.contains('ptr-ready');
      pulling = false;
      startY = null;
      if (!wasReady) {
        setTravel(0, 0);
        return;
      }
      refreshing = true;
      indicator.classList.add('ptr-spinning');
      setTravel(MAX_PULL, 1);
      const minSpin = new Promise((r) => setTimeout(r, 500)); // a flash read as broken, not done
      try {
        await Promise.all([onRefresh(), minSpin]);
      } catch {
        // each load* function already handles its own errors and leaves the
        // last-good render in place — nothing extra to show here.
      }
      indicator.classList.remove('ptr-spinning', 'ptr-ready');
      setTravel(0, 0);
      refreshing = false;
    },
    { passive: true }
  );
})(refreshDashboard);
