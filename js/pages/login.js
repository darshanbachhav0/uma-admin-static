/**
 * Administrator sign-in screen.
 *
 * Keyboard submission, accessible labels, inline validation, a password
 * visibility toggle, a loading state and human-readable Firebase errors.
 */
import { h, replaceChildren, uid } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { button, field, passwordInput, setButtonLoading, textInput } from '../ui/controls.js';
import { notify } from '../ui/toast.js';
import { signIn, sendPasswordReset } from '../core/session.js';
import { describeError, isEmail } from '../utils/validate.js';

const HIGHLIGHTS = [
  { icon: 'calendar-days', text: 'Publica y actualiza los eventos institucionales' },
  { icon: 'clipboard-list', text: 'Consulta y exporta las inscripciones de estudiantes' },
  { icon: 'shield-check', text: 'Administra cuentas con trazabilidad completa' },
];

export function renderLogin(root) {
  const formId = uid('login-form');

  const emailInput = textInput({
    type: 'email',
    autocomplete: 'username',
    placeholder: 'nombre@uma.edu.pe',
    required: true,
    inputmode: 'email',
  });
  const emailField = field({ label: 'Correo institucional', control: emailInput, required: true });

  const passwordWrapper = passwordInput({ autocomplete: 'current-password', placeholder: '••••••••', required: true });
  const passwordField = field({
    label: 'Contraseña',
    control: passwordWrapper.input,
    render: passwordWrapper,
    required: true,
  });

  const alertBox = h('p', { class: 'alert hidden', role: 'alert' }, icon('alert-circle', { size: 16 }), h('span', { text: '' }));

  const submitBtn = button({ label: 'Iniciar sesión', variant: 'primary', size: 'lg', block: true, type: 'submit' });

  const form = h('form', { class: 'auth-panel__form', id: formId, novalidate: true },
    alertBox,
    emailField,
    passwordField,
    submitBtn,
    h('button', {
      class: 'btn btn--ghost btn--sm',
      type: 'button',
      style: { 'align-self': 'center' },
      onclick: () => requestReset(),
      text: '¿Olvidaste tu contraseña?',
    }));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    await submit();
  });

  function showAlert(message) {
    alertBox.lastElementChild.textContent = message;
    alertBox.classList.remove('hidden');
  }

  function clearAlert() {
    alertBox.classList.add('hidden');
    alertBox.lastElementChild.textContent = '';
  }

  function validate() {
    let valid = true;
    emailField.clearError();
    passwordField.clearError();

    const email = emailInput.value.trim();
    if (!email) { emailField.setError('Escribe tu correo institucional.'); valid = false; }
    else if (!isEmail(email)) { emailField.setError('El correo no tiene un formato válido.'); valid = false; }

    if (!passwordWrapper.input.value) { passwordField.setError('Escribe tu contraseña.'); valid = false; }
    return valid;
  }

  async function submit() {
    clearAlert();
    if (!validate()) {
      const firstInvalid = form.querySelector('.field.is-invalid .input');
      if (firstInvalid) firstInvalid.focus();
      return;
    }

    setButtonLoading(submitBtn, true);
    try {
      await signIn(emailInput.value, passwordWrapper.input.value);
      // The session observer swaps the screen; nothing else to do here.
    } catch (error) {
      console.error('[login] autenticación fallida', error);
      showAlert(describeError(error, 'No se pudo iniciar sesión. Inténtalo de nuevo.'));
      passwordWrapper.input.value = '';
      passwordWrapper.input.focus();
      setButtonLoading(submitBtn, false);
    }
  }

  async function requestReset() {
    const email = emailInput.value.trim();
    emailField.clearError();
    if (!isEmail(email)) {
      emailField.setError('Escribe tu correo para enviarte el enlace de restablecimiento.');
      emailInput.focus();
      return;
    }
    try {
      await sendPasswordReset(email);
      notify.success(`Si existe una cuenta con ${email}, recibirás un enlace para restablecer tu contraseña.`);
    } catch (error) {
      console.error('[login] restablecimiento fallido', error);
      notify.error(describeError(error, 'No se pudo enviar el enlace de restablecimiento.'));
    }
  }

  const screen = h('div', { class: 'auth-screen' },
    h('aside', { class: 'auth-screen__aside' },
      h('div', { class: 'brand-lockup brand-lockup--inverse' },
        h('span', { class: 'brand-mark brand-mark--inverse', text: 'UMA' }),
        h('span', { class: 'brand-text' },
          h('span', { class: 'brand-text__name', text: 'UMA Admin' }),
          h('span', { class: 'brand-text__sub', text: 'Consola institucional' }))),
      h('div', null,
        h('h1', { class: 'auth-screen__aside-title', text: 'Consola de administración universitaria' }),
        h('p', { class: 'auth-screen__aside-text', text: 'Gestiona eventos, inscripciones y cuentas de la Universidad María Auxiliadora desde un solo lugar.' }),
        h('ul', { class: 'auth-screen__aside-list' },
          ...HIGHLIGHTS.map((item) => h('li', null, icon(item.icon, { size: 18 }), h('span', { text: item.text }))))),
      h('p', { class: 'auth-screen__aside-foot', text: 'Acceso restringido al personal autorizado.' })),

    h('div', { class: 'auth-screen__main' },
      h('div', { class: 'auth-panel' },
        h('div', { class: 'brand-lockup', style: { 'margin-bottom': '8px' } },
          h('span', { class: 'brand-mark', text: 'UMA' }),
          h('span', { class: 'brand-text' },
            h('span', { class: 'brand-text__name', text: 'UMA Admin' }))),
        h('div', { class: 'auth-panel__head' },
          h('h2', { class: 'auth-panel__title', text: 'Iniciar sesión' }),
          h('p', { class: 'auth-panel__subtitle', text: 'Usa tu cuenta institucional con permisos de administrador.' })),
        form,
        h('p', { class: 'auth-panel__foot', text: 'Universidad María Auxiliadora · Uso interno' }))));

  replaceChildren(root, screen);
  document.title = 'Iniciar sesión · UMA Admin';
  requestAnimationFrame(() => emailInput.focus());
  return screen;
}
