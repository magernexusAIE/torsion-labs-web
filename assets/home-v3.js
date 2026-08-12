(()=>{
  'use strict';
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');

  document.querySelectorAll('[data-sequence]').forEach((sequence)=>{
    const frames=[...sequence.querySelectorAll('[data-frame]')];
    const host=sequence.closest('.cinema-hero,.project-card');
    const controls=host?.querySelector('[data-controls]');
    const dots=controls?[...controls.querySelectorAll('[data-go]')]:[];
    const pause=controls?.querySelector('[data-pause]');
    const current=host?.querySelector('[data-current]');
    let index=0,timer=0,paused=reduced.matches;

    const show=(next)=>{
      index=(next+frames.length)%frames.length;
      frames.forEach((frame,i)=>frame.classList.toggle('is-active',i===index));
      dots.forEach((dot,i)=>{
        dot.classList.toggle('is-active',i===index);
        if(i===index) dot.setAttribute('aria-current','true'); else dot.removeAttribute('aria-current');
      });
      if(current) current.textContent=String(index+1).padStart(2,'0');
    };
    const stop=()=>{window.clearInterval(timer);timer=0;};
    const start=()=>{stop();if(!paused&&!reduced.matches&&frames.length>1)timer=window.setInterval(()=>show(index+1),Number(sequence.dataset.interval)||6000)};
    dots.forEach(dot=>dot.addEventListener('click',()=>{show(Number(dot.dataset.go));start()}));
    pause?.addEventListener('click',()=>{paused=!paused;pause.textContent=paused?'▶':'Ⅱ';pause.setAttribute('aria-label',paused?'Reanudar secuencia':'Pausar secuencia');start()});
    host?.addEventListener('mouseenter',()=>{if(!controls)stop()});
    host?.addEventListener('mouseleave',()=>{if(!controls)start()});
    reduced.addEventListener?.('change',()=>{paused=reduced.matches;show(0);start()});
    start();
  });

  if(!reduced.matches){
    document.querySelectorAll('.motion-field').forEach(field=>{
      let raf=0,x=0,y=0;
      const apply=()=>{field.style.setProperty('--mx',x.toFixed(3));field.style.setProperty('--my',y.toFixed(3));raf=0};
      field.addEventListener('pointermove',event=>{const r=field.getBoundingClientRect();x=(event.clientX-r.left)/r.width-.5;y=(event.clientY-r.top)/r.height-.5;if(!raf)raf=requestAnimationFrame(apply)},{passive:true});
      field.addEventListener('pointerleave',()=>{x=0;y=0;if(!raf)raf=requestAnimationFrame(apply)},{passive:true});
    });
  }

  const progress=document.querySelector('.scroll-progress');
  const updateScroll=()=>{const max=document.documentElement.scrollHeight-innerHeight;progress?.style.setProperty('--scroll',max>0?Math.min(1,scrollY/max):0)};
  addEventListener('scroll',updateScroll,{passive:true});updateScroll();

  const sections=document.querySelectorAll('.reveal-section');
  if('IntersectionObserver' in window&&!reduced.matches){
    const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('is-visible');observer.unobserve(entry.target)}}),{threshold:.12});
    sections.forEach(section=>observer.observe(section));
  }else sections.forEach(section=>section.classList.add('is-visible'));
})();
