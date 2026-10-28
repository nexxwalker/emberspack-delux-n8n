import logo from '../assets/ember-spark.png';

// Native details provides keyboard activation and exposes its expanded state.
export function initContact() {
  const contact = document.getElementById('contact');
  const trigger = contact.querySelector('summary');
  document.getElementById('contactLogo').src = logo;
  const close = () => {
    contact.open = false;
    trigger.focus();
  };
  document.getElementById('contactClose').addEventListener('click', close);
  document.addEventListener('pointerdown', (event) => {
    if (contact.open && !contact.contains(event.target)) contact.open = false;
  });
  window.addEventListener(
    'keydown',
    (event) => {
      if (contact.open && event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
      } else if (contact.contains(event.target)) {
        // Keep the office's single-key shortcuts out of the contact controls.
        event.stopImmediatePropagation();
      }
    },
    true,
  );
}
