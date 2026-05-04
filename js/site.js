/* EasyErgo — site script. Vanilla, no dependencies. */
(() => {
  'use strict';

  // Sticky header shadow
  const header = document.querySelector('.site-header');
  if (header) {
    const onScroll = () => {
      header.classList.toggle('scrolled', window.scrollY > 24);
    };
    window.addEventListener('scroll', onScroll, {passive: true});
    onScroll();
  }

  // Reveal-on-scroll using IntersectionObserver
  const reveals = document.querySelectorAll('.reveal');
  if (reveals.length && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      });
    }, {threshold: 0.12, rootMargin: '0px 0px -10% 0px'});
    reveals.forEach((el) => io.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add('is-visible'));
  }

  // Mount any [data-glb] containers using the standalone GLB viewer
  // (loaded from js/glb-viewer.js, requires three.min.js + OrbitControls
  // + meshopt_decoder). Containers with [data-glb-eager] mount as soon
  // as the viewer is ready; everything else waits until it scrolls into
  // view (so the 56MB GLB on the demo section doesn't compete with the
  // hero's video for bandwidth on first paint).
  function mountOne(el) {
    if (el.hasAttribute('data-glb-mounted')) return;
    if (!window.EasyErgoGlbViewer || !window.THREE) return;
    const src = el.getAttribute('data-glb');
    if (!src) return;
    el.setAttribute('data-glb-mounted', 'true');

    const prog = el.querySelector('[data-glb-progress]');
    const overlay = el.querySelector('[data-glb-overlay]');

    // Optional source video used to drive GLB time, so the 3D pose
    // and the source clip stay in lockstep across loops. If the
    // selector matches a <video>, the viewer reads its currentTime
    // every frame and applies the corresponding pose frame.
    const syncSel = el.dataset.glbSyncVideo;
    const syncVideo = syncSel ? document.querySelector(syncSel) : null;

    window.EasyErgoGlbViewer.mount(el, {
      src,
      autoplay: true,
      loop: true,
      autoOrbit: el.dataset.glbOrbit !== 'false',
      orbitSpeed: parseFloat(el.dataset.glbOrbitSpeed || '0.3'),
      interactive: el.dataset.glbInteractive === 'true',
      background: parseInt(el.dataset.glbBg || '0x0F1F3D', 16),
      cameraYaw: parseFloat(el.dataset.glbYaw ?? '45'),
      cameraPitch: parseFloat(el.dataset.glbPitch ?? '0'),
      syncVideo: syncVideo instanceof HTMLVideoElement ? syncVideo : null,
      onProgress: (pct) => {if (prog) prog.style.width = pct + '%';},
      onReady: () => {if (overlay) overlay.style.opacity = '0';},
      onError: (err) => {
        console.error('GLB viewer error', err);
        if (overlay) overlay.textContent = 'Could not load 3D model.';
      },
    });
  }

  function scanAndMount() {
    if (!window.EasyErgoGlbViewer || !window.THREE) return;
    document.querySelectorAll('[data-glb]:not([data-glb-mounted])').forEach((el) => {
      if (el.hasAttribute('data-glb-eager')) {
        mountOne(el);
      } else if ('IntersectionObserver' in window) {
        const io = new IntersectionObserver((entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              mountOne(entry.target);
              io.unobserve(entry.target);
            }
          });
        }, {rootMargin: '200px 0px'});
        io.observe(el);
      } else {
        mountOne(el);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scanAndMount);
  } else {
    scanAndMount();
  }
  setTimeout(scanAndMount, 200);
  setTimeout(scanAndMount, 1000);

  // Loop safety net: very rarely a codec/browser combo fires `ended`
  // even with loop=true. Restart on `ended` only — DON'T watch `pause`
  // (the browser briefly pauses to seek when looping naturally, and a
  // pause-listener that races the browser's restart causes stutter).
  document.querySelectorAll('video[data-loop-watchdog]').forEach((v) => {
    v.addEventListener('ended', () => {
      try {v.currentTime = 0; v.play().catch(() => {});} catch (_) {}
    });
    // Re-attempt autoplay after first user gesture (mobile autoplay block).
    const kick = () => {v.play().catch(() => {}); document.removeEventListener('pointerdown', kick);};
    document.addEventListener('pointerdown', kick, {once: true});
  });

  // Update copyright year
  document.querySelectorAll('[data-year]').forEach((el) => {
    el.textContent = String(new Date().getFullYear());
  });
})();
