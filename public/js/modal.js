/**
 * BLUE - Info & Copyright Modal Manager with Focus Trap
 */

(function () {
  const infoBtn = document.getElementById('info-btn');
  const infoModal = document.getElementById('info-modal');
  const closeModalBtn = document.getElementById('close-modal-btn');

  if (!infoBtn || !infoModal) return;

  function handleKeydown(e) {
    if (!infoModal.classList.contains('open')) return;

    if (e.key === 'Escape') {
      closeModal();
      return;
    }

    if (e.key === 'Tab') {
      const focusableEls = infoModal.querySelectorAll(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusableEls.length) return;

      const firstEl = focusableEls[0];
      const lastEl = focusableEls[focusableEls.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === firstEl || !infoModal.contains(document.activeElement)) {
          e.preventDefault();
          lastEl.focus();
        }
      } else {
        if (document.activeElement === lastEl || !infoModal.contains(document.activeElement)) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    }
  }

  function openModal() {
    infoModal.classList.add('open');
    infoModal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeydown);
    if (closeModalBtn) closeModalBtn.focus();
  }

  function closeModal() {
    infoModal.classList.remove('open');
    infoModal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    document.removeEventListener('keydown', handleKeydown);
    if (infoBtn) infoBtn.focus();
  }

  infoBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openModal();
  });

  if (closeModalBtn) {
    closeModalBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeModal();
    });
  }

  // Dismiss on backdrop click
  infoModal.addEventListener('click', (e) => {
    if (e.target === infoModal) {
      closeModal();
    }
  });
})();
