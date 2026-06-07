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

  const updateState = () => {
    // Show/hide based on scroll position with tolerance
    const isAtStart = row.scrollLeft <= 5;
    
    // Check if we can scroll right
    // scrollWidth might be slightly larger due to sub-pixel rendering
    const maxScroll = row.scrollWidth - row.clientWidth;
    const isAtEnd = row.scrollLeft >= maxScroll - 5;
    
    left.classList.toggle('hidden', isAtStart);
    right.classList.toggle('hidden', isAtEnd);

    container.classList.toggle('mask-left', !isAtStart);
    container.classList.toggle('mask-right', !isAtEnd);
  };

  left.onclick = () => {
    row.scrollBy({ left: -getScrollAmount(), behavior: 'smooth' });
  };

  right.onclick = () => {
    row.scrollBy({ left: getScrollAmount(), behavior: 'smooth' });
  };

  row.addEventListener('scroll', () => {
    requestAnimationFrame(updateState);
  });
  
  // Initial check
  setTimeout(updateState, 100);
  window.addEventListener('resize', updateState);
}
