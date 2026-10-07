(() => {
  const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
  const visualElements = [...document.querySelectorAll('[data-torsion-visual]')];
  const brandControl = document.querySelector('[data-brand-motion-toggle]');
  const visuals = visualElements.map(element => ({
    element, canvas: element.querySelector('.torsion-water-canvas'),
    kind: element.dataset.torsionVisual, inView: true,
    stages: [...element.querySelectorAll('[data-flow-stage]')], activeStage: 1,
    pointer: { x: 0, y: 0, target: 0, strength: 0 },
  })).filter(state => state.canvas);
  let brandPaused = false;
  let brandFrame = 0;
  let previousTime = null;
  let elapsed = 0;
  const armCurves = [
    [[0, 0], [2, -20], [22, -28], [36, -16]],
    [[36, -16], [46, -7], [46, 12], [34, 22]],
  ];

  function bezier(points, t) {
    const u = 1 - t;
    return [0, 1].map(axis => u ** 3 * points[0][axis] + 3 * u ** 2 * t * points[1][axis] +
      3 * u * t ** 2 * points[2][axis] + t ** 3 * points[3][axis]);
  }

  function prepareVisual(state) {
    const box = state.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(box.width));
    const height = Math.max(1, Math.round(box.height));
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const ctx = state.canvas.getContext('2d');
    if (!ctx) return null;
    if (state.canvas.width !== Math.round(width * dpr) || state.canvas.height !== Math.round(height * dpr)) {
      state.canvas.width = Math.round(width * dpr);
      state.canvas.height = Math.round(height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, width, height, radius: Math.min(width, height) * .34 };
  }

  function methodPoint(t, width, height) {
    return [width * (.1 + .8 * t), height * (.5 - .09 * Math.cos(t * Math.PI * 3))];
  }

  function paintMethodFlow(state, { ctx, width, height }) {
    const ink = '#708995', jade = '#247b63';
    const [activeX] = methodPoint(state.activeStage / 3, width, height);
    ctx.clearRect(0, 0, width, height);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.setLineDash([]);
    const trace = (echo = 0, highlight = false) => {
      ctx.beginPath();
      let started = false;
      for (let sample = 0; sample <= 128; sample += 1) {
        const t = -.0875 + sample / 128 * 1.175;
        const [x, baseline] = methodPoint(t, width, height);
        const distance = Math.hypot(x - state.pointer.x, baseline - state.pointer.y);
        const ripple = Math.sin(distance / Math.max(12, height * .13) - elapsed * 5) *
          Math.exp(-((distance / (width * .16)) ** 2)) * state.pointer.strength * Math.min(5, height * .018);
        const y = baseline + echo * (3 + Math.sin(t * 8) * 1.5) + ripple;
        if (highlight && Math.abs(x - activeX) > width * .06) continue;
        if (!started) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        started = true;
      }
      ctx.stroke();
    };
    ctx.strokeStyle = ink; ctx.lineWidth = 1; ctx.globalAlpha = .2;
    trace(-1); trace(1);
    ctx.globalAlpha = .8; ctx.lineWidth = 1.25; trace();
    ctx.strokeStyle = jade; ctx.lineWidth = 1.8; ctx.globalAlpha = 1; trace(0, true);
    for (let index = 0; index < 4; index += 1) {
      const [x, y] = methodPoint(index / 3, width, height);
      const active = index === state.activeStage;
      ctx.strokeStyle = active ? jade : ink; ctx.lineWidth = 1; ctx.globalAlpha = .65;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + (index % 2 ? 1 : -1) * height * .085); ctx.stroke();
      if (active) {
        ctx.globalAlpha = .14; ctx.fillStyle = '#62c9a9';
        ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1; ctx.fillStyle = active ? jade : ink;
      ctx.beginPath(); ctx.arc(x, y, active ? 4.5 : 3.5, 0, Math.PI * 2); ctx.fill();
      state.stages[index]?.classList.toggle('is-active', active);
    }
    state.element.classList.add('is-ready');
  }

  function paintVisual(state) {
    const prepared = prepareVisual(state);
    if (!prepared) return;
    const { ctx, width, height, radius } = prepared;
    if (state.kind === 'method') { paintMethodFlow(state, prepared); return; }
    const unit = radius / 52;
    const cx = width / 2, cy = height / 2;
    const dark = state.kind === 'hero';
    const ink = dark ? '#b8c9d3' : '#536b7b';
    const paper = dark ? '#11191c' : '#f4f1e9';
    const copper = dark ? '#d6aa7c' : '#a36c42';
    ctx.clearRect(0, 0, width, height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const circle = (x, y, r, color, fill = false) => {
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      if (fill) { ctx.fillStyle = color; ctx.fill(); }
      else { ctx.strokeStyle = color; ctx.stroke(); }
    };
    ctx.lineWidth = Math.max(.6, unit * .2);
    ctx.globalAlpha = .6;
    circle(cx, cy, radius, ink);
    ctx.setLineDash([unit * .5, unit * 1.2]);
    ctx.globalAlpha = .28;
    circle(cx, cy, radius * 1.15, ink);
    ctx.setLineDash([]);
    const count = dark ? 6 : 4;
    for (let i = 0; i < count; i += 1) {
      const angle = -Math.PI / 2 + i * Math.PI * 2 / count + (dark ? Math.PI / 6 : 0);
      const x = cx + Math.cos(angle) * radius * 1.1;
      const y = cy + Math.sin(angle) * radius * 1.1;
      ctx.globalAlpha = .2;
      ctx.beginPath(); ctx.moveTo(x, y);
      ctx.quadraticCurveTo(cx + Math.sin(angle) * radius * .5, cy, cx, cy); ctx.strokeStyle = ink; ctx.stroke();
      ctx.globalAlpha = .8;
      circle(x, y, unit * 2.8, paper, true);
      circle(x, y, unit * 2.8, ink);
      circle(x, y, unit * 1.2, i % 3 === 0 ? copper : ink, true);
    }
    const metallic = ctx.createLinearGradient(cx - radius, cy - radius, cx + radius, cy + radius);
    metallic.addColorStop(0, dark ? '#f4f1e9' : '#829cac');
    metallic.addColorStop(.42, ink);
    metallic.addColorStop(.7, dark ? '#708a9b' : '#344e5c');
    metallic.addColorStop(1, dark ? '#e1e9ee' : '#a9b9c1');
    const drawArms = (scale, rotation, watery) => {
      ctx.lineWidth = Math.max(1, unit * (scale === 1 ? 1.7 : 1));
      ctx.strokeStyle = metallic;
      ctx.globalAlpha = .96;
      for (let arm = 0; arm < 3; arm += 1) {
        const angle = rotation + arm * Math.PI * 2 / 3;
        ctx.beginPath();
        for (let curve = 0; curve < armCurves.length; curve += 1) {
          for (let sample = 0; sample <= 28; sample += 1) {
            const point = bezier(armCurves[curve], sample / 28);
            const x0 = (point[0] * Math.cos(angle) - point[1] * Math.sin(angle)) * unit * scale;
            const y0 = (point[0] * Math.sin(angle) + point[1] * Math.cos(angle)) * unit * scale;
            const distance = Math.hypot(cx + x0 - state.pointer.x, cy + y0 - state.pointer.y);
            const ripple = watery ? Math.sin(distance / (unit * 3.5) - elapsed * 5) *
              Math.exp(-distance / (radius * .7)) * state.pointer.strength * radius * .023 : 0;
            const normal = Math.atan2(y0, x0) + Math.PI / 2;
            const x = cx + x0 + Math.cos(normal) * ripple;
            const y = cy + y0 + Math.sin(normal) * ripple;
            if (curve === 0 && sample === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
      }
    };
    drawArms(1, 0, true);
    ctx.globalAlpha = 1;
    circle(cx, cy, unit * 16, paper, true);
    ctx.globalAlpha = .25;
    circle(cx, cy, unit * 16, ink);
    // The small three-arm helix turns once every 36 seconds. The outer arms stay legible.
    drawArms(.27, -elapsed * Math.PI * 2 / 36, false);
    ctx.globalAlpha = 1;
    circle(cx, cy, unit * 2.2, copper, true);
    state.element.classList.add('is-ready');
  }

  const brandEnabled = () => !brandPaused && !motionPreference.matches && !document.hidden;
  const brandAllowed = () => brandEnabled() && visuals.some(state => state.inView &&
    (state.kind === 'hero' || state.pointer.target > 0 || state.pointer.strength > .001));
  function updateBrandControl() {
    if (!brandControl) return;
    const staticMotion = motionPreference.matches;
    const label = staticMotion ? brandControl.dataset.labelStatic :
      brandPaused ? brandControl.dataset.labelPlay : brandControl.dataset.labelPause;
    brandControl.hidden = false;
    brandControl.disabled = staticMotion;
    brandControl.textContent = label;
    brandControl.setAttribute('aria-label', label);
    brandControl.setAttribute('aria-pressed', String(brandPaused || staticMotion));
  }
  function drawBrand(time) {
    brandFrame = 0;
    if (brandAllowed()) {
      if (previousTime !== null) elapsed += Math.max(0, Math.min(time - previousTime, 48)) / 1000;
      previousTime = time;
    }
    for (const state of visuals) {
      state.pointer.strength += (state.pointer.target - state.pointer.strength) * .12;
      if (state.inView || !brandAllowed()) paintVisual(state);
    }
    if (brandAllowed()) brandFrame = requestAnimationFrame(drawBrand);
  }
  function syncBrandMotion() {
    cancelAnimationFrame(brandFrame);
    brandFrame = 0;
    previousTime = null;
    if (!brandAllowed() || !finePointer.matches) for (const state of visuals) state.pointer.target = state.pointer.strength = 0;
    updateBrandControl();
    drawBrand(performance.now());
  }
  for (const state of visuals) {
    state.element.addEventListener('pointermove', event => {
      if (!finePointer.matches || !brandEnabled() || !state.inView) return;
      const box = state.canvas.getBoundingClientRect();
      state.pointer.x = event.clientX - box.left;
      state.pointer.y = event.clientY - box.top;
      if (state.kind === 'method') {
        const t = Math.max(0, Math.min(1, (state.pointer.x / box.width - .1) / .8));
        const [, lineY] = methodPoint(t, box.width, box.height);
        state.pointer.target = Math.abs(state.pointer.y - lineY) < box.height * .24 ? 1 : 0;
        state.activeStage = state.pointer.target ? Math.round(t * 3) : 1;
      } else {
        const radius = Math.min(box.width, box.height) * .34;
        state.pointer.target = Math.hypot(state.pointer.x - box.width / 2, state.pointer.y - box.height / 2) < radius * 1.2 ? 1 : 0;
      }
      if (!brandFrame && brandAllowed()) { previousTime = null; drawBrand(performance.now()); }
      else if (state.kind === 'method' && !brandFrame) paintVisual(state);
    });
    state.element.addEventListener('pointerleave', () => { state.pointer.target = 0; state.activeStage = 1; });
  }
  if (brandControl) brandControl.addEventListener('click', () => { brandPaused = !brandPaused; syncBrandMotion(); });
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const state = visuals.find(item => item.element === entry.target);
        if (state) state.inView = entry.isIntersecting;
      }
      syncBrandMotion();
    }, { threshold: .1 });
    for (const state of visuals) observer.observe(state.element);
  }
  motionPreference.addEventListener('change', syncBrandMotion);
  finePointer.addEventListener('change', syncBrandMotion);
  document.addEventListener('visibilitychange', syncBrandMotion);
  addEventListener('resize', syncBrandMotion);
  syncBrandMotion();

  const panel = document.querySelector('.domain-panel');
  const buttons = [...document.querySelectorAll('[data-domain]')];
  buttons.forEach((button, index) => button.addEventListener('click', () => {
    buttons.forEach(item => item.classList.toggle('active', item === button));
    panel.querySelector('span').textContent = `${String(index + 1).padStart(2,'0')} / 06`;
    panel.querySelector('h3').textContent = button.dataset.domain;
    panel.querySelector('p').textContent = button.dataset.copy;
    panel.querySelector('a').href = button.dataset.link;
  }));
  buttons[0].classList.add('active');

  const deck = document.querySelector('[data-live-deck]');
  if (deck) {
    const tabs = [...deck.querySelectorAll('[data-live-tab]')];
    const panels = [...deck.querySelectorAll('[data-live-panel]')];
    const motionToggle = deck.querySelector('[data-motion-toggle]');
    let activeId = tabs[0].dataset.liveTab;
    let pausedByUser = false;
    let inViewport = true;

    const activeVideo = () => deck.querySelector(`[data-live-panel="${activeId}"] video`);

    function updateMotionControl() {
      const stopped = pausedByUser || motionPreference.matches;
      motionToggle.disabled = motionPreference.matches;
      const label = stopped ? motionToggle.dataset.labelPlay : motionToggle.dataset.labelPause;
      motionToggle.textContent = label;
      motionToggle.setAttribute('aria-label', label);
      motionToggle.setAttribute('aria-pressed', String(stopped));
      deck.classList.toggle('is-paused', stopped);
    }

    function syncPlayback() {
      panels.forEach(item => {
        const video = item.querySelector('video');
        const shouldPlay = item.dataset.livePanel === activeId && !pausedByUser && !motionPreference.matches && inViewport && !document.hidden;
        video.muted = true;
        const configuredRate = Number(video.dataset.playbackRate);
        const playbackRate = Number.isFinite(configuredRate) && configuredRate > 0 && configuredRate <= 1 ? configuredRate : 1;
        video.defaultPlaybackRate = playbackRate;
        video.playbackRate = playbackRate;
        if (shouldPlay) video.play().catch(() => {});
        else video.pause();
      });
    }

    function activate(id, moveFocus = false) {
      if (!tabs.some(tab => tab.dataset.liveTab === id)) return;
      activeId = id;
      tabs.forEach(tab => {
        const selected = tab.dataset.liveTab === id;
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;
        if (selected && moveFocus) tab.focus();
      });
      panels.forEach(item => { item.hidden = item.dataset.livePanel !== id; });
      const video = activeVideo();
      if (video && video.currentTime > .1) video.currentTime = 0;
      syncPlayback();
    }

    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => activate(tab.dataset.liveTab));
      tab.addEventListener('keydown', event => {
        let next = null;
        if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
        if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
        if (event.key === 'Home') next = 0;
        if (event.key === 'End') next = tabs.length - 1;
        if (next === null) return;
        event.preventDefault();
        activate(tabs[next].dataset.liveTab, true);
      });
    });

    motionToggle.addEventListener('click', () => {
      pausedByUser = !pausedByUser;
      updateMotionControl();
      syncPlayback();
    });

    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(entries => {
        inViewport = entries[0].isIntersecting;
        syncPlayback();
      }, {threshold: .15});
      observer.observe(deck);
    }

    motionPreference.addEventListener('change', () => {
      updateMotionControl();
      syncPlayback();
    });
    document.addEventListener('visibilitychange', syncPlayback);
    updateMotionControl();
    activate(activeId);
  }
})();
