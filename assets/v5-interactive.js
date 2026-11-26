(() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');

  // 1. Filtros interactivos (Portafolio y Evidencia)
  document.querySelectorAll('[data-v5-filter-root]').forEach(root => {
    const btns = [...root.querySelectorAll('[data-filter-value]')];
    const items = [...root.querySelectorAll('[data-filter-tags]')];
    const countEl = root.querySelector('[data-filter-count]');
    const tpl = countEl ? (countEl.dataset.countTemplate || '{n} / {total}') : '';

    function apply(val) {
      let shown = 0;
      items.forEach(card => {
        const tags = (card.dataset.filterTags || '').split(/\s+/).filter(Boolean);
        const match = val === 'all' || tags.includes(val);
        card.hidden = !match;
        if (match) shown += 1;
      });
      btns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.filterValue === val)));
      if (countEl) {
        countEl.textContent = tpl.replace('{n}', String(shown)).replace('{total}', String(items.length));
      }
    }

    btns.forEach(btn => btn.addEventListener('click', () => apply(btn.dataset.filterValue)));
    apply('all');
  });

  // 2. Video embebido en tarjeta protagonista de Portafolio
  document.querySelectorAll('[data-featured-video-toggle]').forEach(btn => {
    const box = btn.closest('.identity-card__video-box');
    const vid = box ? box.querySelector('video') : null;
    if (!vid) return;
    let paused = reduced.matches;
    const sync = () => {
      vid.muted = true;
      if (paused) { vid.pause(); btn.textContent = btn.dataset.labelPlay || 'Reproducir'; }
      else { vid.play().catch(() => {}); btn.textContent = btn.dataset.labelPause || 'Pausar'; }
      btn.setAttribute('aria-pressed', String(paused));
    };
    btn.addEventListener('click', () => { paused = !paused; sync(); });
    sync();
  });

  // 3. Switcher interactivo de escenas de video en fichas de proyecto
  document.querySelectorAll('[data-v5-showcase]').forEach(box => {
    const tabs = [...box.querySelectorAll('[data-scene-tab]')];
    const panels = [...box.querySelectorAll('[data-scene-panel]')];

    function show(id) {
      tabs.forEach(t => t.setAttribute('aria-selected', String(t.dataset.sceneTab === id)));
      panels.forEach(p => {
        const active = p.dataset.scenePanel === id;
        p.hidden = !active;
        const vid = p.querySelector('video');
        if (!vid) return;
        vid.muted = true;
        if (active && !reduced.matches) vid.play().catch(() => {});
        else vid.pause();
      });
    }

    tabs.forEach(t => t.addEventListener('click', () => show(t.dataset.sceneTab)));
    if (tabs.length) show(tabs[0].dataset.sceneTab);
  });

  // 4. Explorador interactivo por pasos / pilares (Torsion Local + OmniPredict)
  document.querySelectorAll('[data-v5-stepper]').forEach(stepper => {
    const btns = [...stepper.querySelectorAll('[data-step-btn]')];
    const kicker = stepper.querySelector('[data-step-kicker]');
    const title = stepper.querySelector('[data-step-title]');
    const body = stepper.querySelector('[data-step-body]');
    const meta = stepper.querySelector('[data-step-meta]');

    function select(btn) {
      btns.forEach(b => b.setAttribute('aria-selected', String(b === btn)));
      if (kicker) kicker.textContent = btn.dataset.kicker || '';
      if (title) title.textContent = btn.dataset.title || '';
      if (body) body.textContent = btn.dataset.body || '';
      if (meta) meta.textContent = btn.dataset.meta || '';
    }

    btns.forEach(btn => btn.addEventListener('click', () => select(btn)));
    if (btns.length) select(btns[0]);
  });
})();
