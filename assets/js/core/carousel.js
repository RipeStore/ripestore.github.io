/**
 * Initializes a scroll container with buttons.
 * @param {Element} container - The wrapper .carousel-container
 */
export function initCarousel(container) {
  const row = container.querySelector('.scroll-row');
  const left = container.querySelector('.scroll-btn.left');
  const right = container.querySelector('.scroll-btn.right');
  if (!row || !left || !right) return;

  // Calculate scroll amount based on item width
  const getScrollAmount = () => {
    if (row.children.length > 0) {
      // item width + gap (16px)
      return row.children[0].clientWidth + 16;
    }
    return 340;
  };

  const updateButtons = () => {
    // Show/hide based on scroll position with tolerance
    left.classList.toggle('hidden', row.scrollLeft <= 5);
    
    // Check if we can scroll right
    // scrollWidth might be slightly larger due to sub-pixel rendering
    const maxScroll = row.scrollWidth - row.clientWidth;
    right.classList.toggle('hidden', row.scrollLeft >= maxScroll - 5);
  };

  left.onclick = () => {
    row.scrollBy({ left: -getScrollAmount(), behavior: 'smooth' });
  };

  right.onclick = () => {
    row.scrollBy({ left: getScrollAmount(), behavior: 'smooth' });
  };

  row.addEventListener('scroll', () => {
    // Debounce slightly or just run
    requestAnimationFrame(updateButtons);
  });
  
  // Initial check
  // Need to wait for layout?
  setTimeout(updateButtons, 100);
  // Also on window resize
  window.addEventListener('resize', updateButtons);
}
