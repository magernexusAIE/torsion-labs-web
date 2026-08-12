(() => {
  const elements = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: .1 });
    elements.forEach(element => observer.observe(element));
    return;
  }
  elements.forEach(element => element.classList.add('visible'));
})();
