(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const heroCanvases = [...document.querySelectorAll('.hero-figure')];
  const methodCanvas = document.querySelector('.method-figure');
  const sources = { day: '/assets/cinematic/hero-day.webp', dusk: '/assets/cinematic/hero-dusk.webp', white: '/assets/cinematic/hero-white.webp' };
  const images = Object.fromEntries(Object.entries(sources).map(([name, src]) => {
    const image = new Image(); image.src = src; return [name, image];
  }));
  const shapes = {
    day: { x: .665, y: .49, rx: .235, ry: .36, tilt: -.2, turn: .10, breath: .045, rate: 1.15 },
    dusk: { x: .665, y: .49, rx: .235, ry: .36, tilt: -.2, turn: .085, breath: .04, rate: 1.02 },
    white: { x: .50, y: .55, rx: .205, ry: .30, tilt: 0, turn: .115, breath: .052, rate: .96 }
  };
  let figureFrame = 0;

  function prepareCanvas(canvas) {
    const box = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(box.width));
    const height = Math.max(1, Math.round(box.height));
    const dpr = Math.min(devicePixelRatio, 2);
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) { canvas.width = width * dpr; canvas.height = height * dpr; }
    const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, width, height };
  }
  function paintFigure(canvas, image, shape, time) {
    if (!image.complete || !image.naturalWidth) return;
    const { ctx, width, height } = prepareCanvas(canvas);
    const cover = Math.max(width / image.naturalWidth, height / image.naturalHeight);
    const drawWidth = image.naturalWidth * cover, drawHeight = image.naturalHeight * cover;
    const offsetX = (width - drawWidth) * .5, offsetY = (height - drawHeight) * .5;
    const focalX = offsetX + drawWidth * shape.x, focalY = offsetY + drawHeight * shape.y;
    const seconds = time * .001;
    ctx.clearRect(0, 0, width, height); ctx.save(); ctx.beginPath();
    ctx.ellipse(focalX, focalY, drawWidth * shape.rx, drawHeight * shape.ry, shape.tilt, 0, Math.PI * 2); ctx.clip();
    ctx.globalAlpha = .96; ctx.translate(focalX, focalY); ctx.rotate(Math.sin(seconds * shape.rate) * shape.turn);
    const scale = 1.025 + Math.sin(seconds * shape.rate * 1.45) * shape.breath;
    ctx.scale(scale, scale); ctx.translate(-focalX, -focalY); ctx.drawImage(image, offsetX, offsetY, drawWidth, drawHeight); ctx.restore();
  }
  function drawFigures(time = 0) {
    heroCanvases.forEach(canvas => {
      if (canvas.closest('.hero-scene')?.hidden) return;
      const type = canvas.dataset.heroFigure; paintFigure(canvas, images[type], shapes[type], time);
    });
    if (methodCanvas) paintFigure(methodCanvas, images.white, shapes.white, time);
    if (!reduce) figureFrame = requestAnimationFrame(drawFigures);
  }
  function restartFigureMotion() { cancelAnimationFrame(figureFrame); drawFigures(performance.now()); }
  addEventListener('resize', restartFigureMotion);
  Object.values(images).forEach(image => image.addEventListener('load', restartFigureMotion, { once: true }));
  restartFigureMotion();

  const heroTabs = [...document.querySelectorAll('[data-hero-tab]')];
  const heroScenes = [...document.querySelectorAll('[data-hero-scene]')];
  function selectHeroScene(id) {
    heroTabs.forEach(tab => tab.setAttribute('aria-selected', String(tab.dataset.heroTab === id)));
    heroScenes.forEach(scene => {
      const active = scene.dataset.heroScene === id; scene.hidden = !active;
      const video = scene.querySelector('video'); if (video) active ? video.play().catch(() => {}) : video.pause();
    });
    restartFigureMotion();
  }
  heroTabs.forEach(tab => tab.addEventListener('click', () => selectHeroScene(tab.dataset.heroTab)));

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
    let pausedByUser = reduce;
    let inViewport = true;
    let motionFrame = 0;

    const activeVideo = () => deck.querySelector(`[data-live-panel="${activeId}"] video`);

    function updateMotionControl() {
      const label = pausedByUser ? motionToggle.dataset.labelPlay : motionToggle.dataset.labelPause;
      motionToggle.textContent = label;
      motionToggle.setAttribute('aria-label', label);
      motionToggle.setAttribute('aria-pressed', String(pausedByUser));
      deck.classList.toggle('is-paused', pausedByUser);
    }

    function syncPlayback() {
      panels.forEach(item => {
        const video = item.querySelector('video');
        const shouldPlay = item.dataset.livePanel === activeId && !pausedByUser && inViewport && !document.hidden;
        video.muted = true;
        if (shouldPlay) video.play().catch(() => {});
        else video.pause();
      });
      syncLiveMotion();
    }

    function paintLiveMotion(canvas, time) {
      const panelId = canvas.closest('[data-live-panel]').dataset.livePanel;
      const box = canvas.getBoundingClientRect();
      const dpr = Math.min(devicePixelRatio, 2);
      const width = Math.max(1, Math.round(box.width));
      const height = Math.max(1, Math.round(box.height));
      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }
      const brush = canvas.getContext('2d');
      brush.setTransform(dpr, 0, 0, dpr, 0, 0);
      brush.clearRect(0, 0, width, height);
      const tick = time / 1000 * (panelId === 'field' ? .3 : .8);
      const node = (x, y, radius, color, alpha = 1) => {
        const glow = brush.createRadialGradient(x, y, 0, x, y, radius * 5);
        glow.addColorStop(0, color.replace(')', `,${alpha})`).replace('rgb', 'rgba'));
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        brush.fillStyle = glow;
        brush.beginPath(); brush.arc(x, y, radius * 5, 0, Math.PI * 2); brush.fill();
        brush.fillStyle = color.replace(')', `,${alpha})`).replace('rgb', 'rgba');
        brush.beginPath(); brush.arc(x, y, radius, 0, Math.PI * 2); brush.fill();
      };

      if (panelId === 'field') {
        const cx = width * .64, cy = height * .48;
        for (let index = 0; index < 22; index += 1) {
          const phase = index * .72 + tick * (index % 4 === 0 ? -.72 : .46);
          const orbit = Math.min(width, height) * (.14 + (index % 8) * .032) * (1 + .08 * Math.sin(tick * 1.8 + index));
          const x = cx + Math.cos(phase) * orbit * 1.32;
          const y = cy + Math.sin(phase * 1.22) * orbit * .74;
          const orange = index % 6 === 0;
          const color = orange ? 'rgb(255,138,42)' : 'rgb(206,255,73)';
          brush.strokeStyle = orange ? 'rgba(255,138,42,.20)' : 'rgba(206,255,73,.16)';
          brush.lineWidth = orange ? 1.5 : 1;
          brush.beginPath();
          brush.moveTo(cx + Math.cos(phase - .5) * orbit * .64, cy + Math.sin((phase - .5) * 1.22) * orbit * .38);
          brush.quadraticCurveTo(cx, cy, x, y);
          brush.stroke();
          node(x, y, orange ? 2.6 : 1.6, color, .56 + .32 * Math.sin(tick * 2 + index));
        }
        node(cx, cy, 3.5 + 1.4 * Math.sin(tick * 2.1), 'rgb(206,255,73)', .72);
      } else {
        const nodes = [[.62,.24],[.49,.45],[.73,.48],[.56,.70],[.80,.74],[.66,.38]].map(([x, y]) => [x * width, y * height]);
        const links = [[0,1],[1,2],[1,3],[2,4],[3,4],[0,5],[5,2],[5,3]];
        links.forEach(([from, to], index) => {
          const [x1, y1] = nodes[from], [x2, y2] = nodes[to];
          const bend = (index % 2 ? 1 : -1) * height * .09;
          const midX = (x1 + x2) / 2, midY = (y1 + y2) / 2 + bend;
          brush.strokeStyle = index % 3 === 0 ? 'rgba(255,138,42,.26)' : 'rgba(49,246,232,.22)';
          brush.lineWidth = 1;
          brush.beginPath(); brush.moveTo(x1, y1); brush.quadraticCurveTo(midX, midY, x2, y2); brush.stroke();
          const progress = (tick * .23 + index * .17) % 1;
          const x = (1 - progress) * (1 - progress) * x1 + 2 * (1 - progress) * progress * midX + progress * progress * x2;
          const y = (1 - progress) * (1 - progress) * y1 + 2 * (1 - progress) * progress * midY + progress * progress * y2;
          node(x, y, 2.1, index % 3 === 0 ? 'rgb(255,138,42)' : 'rgb(49,246,232)', .88);
        });
        nodes.forEach(([x, y], index) => node(x, y, 2.3 + .7 * Math.sin(tick * 2 + index), index % 4 === 0 ? 'rgb(255,138,42)' : 'rgb(206,255,73)', .62));
      }
    }

    function drawLiveMotion(time) {
      motionFrame = 0;
      const shouldAnimate = !pausedByUser && inViewport && !document.hidden;
      if (!shouldAnimate) return;
      const activePanel = deck.querySelector(`[data-live-panel="${activeId}"]`);
      const canvas = activePanel && activePanel.querySelector('.live-motion');
      if (canvas) paintLiveMotion(canvas, time);
      motionFrame = requestAnimationFrame(drawLiveMotion);
    }

    function syncLiveMotion() {
      cancelAnimationFrame(motionFrame);
      motionFrame = 0;
      if (!pausedByUser && inViewport && !document.hidden) motionFrame = requestAnimationFrame(drawLiveMotion);
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

    document.addEventListener('visibilitychange', syncPlayback);
    updateMotionControl();
    activate(activeId);
  }
})();
