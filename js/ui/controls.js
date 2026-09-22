/** Shared form and content controls built on top of `dom.js`. */
import { h, uid } from './dom.js';
import { icon } from './icons.js';

/**
 * Button with a built-in loading state that also guards against double submits.
 *
 * @param {object} options
 * @param {string} options.label
 * @param {'primary'|'secondary'|'ghost'|'danger'|'danger-soft'} [options.variant='secondary']
 * @param {string} [options.icon] Icon name rendered before the label.
 * @param {'sm'|'lg'} [options.size]
 * @param {Function} [options.onClick] May return a promise; the button shows a
 *        spinner and stays disabled until it settles.
 * @returns {HTMLButtonElement}
 */
export function button({
  label,
  variant = 'secondary',
  icon: iconName,
  size,
  onClick,
  type = 'button',
  block = false,
  disabled = false,
  title,
  ariaLabel,
  className,
} = {}) {
  const node = h('button', {
    type,
    class: [
      'btn', `btn--${variant}`,
      size ? `btn--${size}` : '',
      block ? 'btn--block' : '',
      label ? '' : 'btn--icon',
      className || '',
    ],
    disabled,
    title,
    'aria-label': ariaLabel || (label ? null : title),
  },
    h('span', { class: 'btn__spinner' }, h('span', { class: 'spinner' })),
    iconName ? h('span', { class: 'btn__icon', style: { display: 'inline-flex' } }, icon(iconName, { size: size === 'sm' ? 15 : 16 })) : null,
    label ? h('span', { class: 'btn__label', text: label }) : null);

  if (typeof onClick === 'function') {
    node.addEventListener('click', async (event) => {
      if (node.dataset.busy === '1' || node.disabled) return;
      const result = onClick(event, node);
      if (!result || typeof result.then !== 'function') return;
      setButtonLoading(node, true);
      try { await result; } finally { setButtonLoading(node, false); }
    });
  }
  return node;
}

/** Toggle a button's spinner + disabled state. Safe to call on detached nodes. */
export function setButtonLoading(node, loading) {
  if (!node) return;
  node.dataset.busy = loading ? '1' : '0';
  node.classList.toggle('is-loading', loading);
  node.disabled = loading;
  node.setAttribute('aria-busy', loading ? 'true' : 'false');
}

/** Icon-only button. */
export function iconButton({ icon: iconName, title, onClick, variant = 'ghost', size = 'sm', ...rest }) {
  return button({ icon: iconName, title, ariaLabel: title, onClick, variant, size, ...rest });
}

/**
 * Labelled field wrapper. Returns the wrapper with `.control` pointing at the
 * input and `setError` / `clearError` helpers for inline validation.
 */
export function field({
  label,
  control,
  /** Node placed in the DOM when it wraps the control (e.g. a password group). */
  render = null,
  hint,
  required = false,
  id = uid('field'),
  span = false,
}) {
  control.id = id;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  const errorEl = h('p', { class: 'field__error', id: errorId, role: 'alert' },
    icon('alert-circle', { size: 13 }), h('span', { text: '' }));

  const wrapper = h('div', { class: ['field', span ? 'span-2' : ''] },
    label ? h('label', { class: 'field__label', for: id },
      label,
      required ? h('span', { class: 'field__required', 'aria-hidden': 'true', text: '*' }) : null) : null,
    render || control,
    hint ? h('p', { class: 'field__hint', id: hintId, text: hint }) : null,
    errorEl);

  if (required) control.setAttribute('aria-required', 'true');
  if (hint) control.setAttribute('aria-describedby', hintId);

  wrapper.control = control;
  wrapper.setError = (message) => {
    wrapper.classList.add('is-invalid');
    errorEl.lastElementChild.textContent = message;
    control.setAttribute('aria-invalid', 'true');
    control.setAttribute('aria-describedby', hint ? `${hintId} ${errorId}` : errorId);
  };
  wrapper.clearError = () => {
    wrapper.classList.remove('is-invalid');
    errorEl.lastElementChild.textContent = '';
    control.removeAttribute('aria-invalid');
    if (hint) control.setAttribute('aria-describedby', hintId);
    else control.removeAttribute('aria-describedby');
  };
  control.addEventListener('input', () => {
    if (wrapper.classList.contains('is-invalid')) wrapper.clearError();
  });
  return wrapper;
}

export function textInput(props = {}) {
  return h('input', { class: 'input', type: 'text', ...props });
}

export function textArea(props = {}) {
  return h('textarea', { class: 'textarea', rows: 4, ...props });
}

/**
 * Select built from `[{value, label}]` options.
 */
export function select({ options = [], value, ...props } = {}) {
  const node = h('select', { class: 'select', ...props },
    ...options.map((opt) => h('option', { value: opt.value, text: opt.label })));
  if (value !== undefined) node.value = value;
  return node;
}

/** Search input with a leading magnifier icon. */
export function searchInput({ placeholder = 'Buscar…', onInput, ariaLabel, value = '' } = {}) {
  const input = h('input', {
    class: 'input',
    type: 'search',
    placeholder,
    value,
    'aria-label': ariaLabel || placeholder,
  });
  if (typeof onInput === 'function') {
    input.addEventListener('input', debounce(() => onInput(input.value), 180));
  }
  const wrapper = h('div', { class: 'input-group' },
    h('span', { class: 'input-group__icon' }, icon('search', { size: 16 })),
    input);
  wrapper.input = input;
  return wrapper;
}

/** Password input with an accessible show/hide toggle. */
export function passwordInput(props = {}) {
  const input = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', ...props });
  const toggle = h('button', {
    class: 'input-group__action',
    type: 'button',
    'aria-label': 'Mostrar contraseña',
    'aria-pressed': 'false',
  }, icon('eye', { size: 16 }));

  toggle.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    toggle.setAttribute('aria-pressed', show ? 'true' : 'false');
    toggle.setAttribute('aria-label', show ? 'Ocultar contraseña' : 'Mostrar contraseña');
    toggle.textContent = '';
    toggle.appendChild(icon(show ? 'eye-off' : 'eye', { size: 16 }));
    input.focus();
  });

  const wrapper = h('div', { class: 'input-group input-group--action' }, input, toggle);
  wrapper.input = input;
  return wrapper;
}

/**
 * Status badge. Always pairs colour with a dot and a text label so status is
 * never communicated by colour alone.
 */
export function badge(label, variant = 'neutral', { dot = true, iconName } = {}) {
  return h('span', { class: ['badge', variant && variant !== 'neutral' ? `badge--${variant}` : ''] },
    iconName ? icon(iconName, { size: 12 }) : (dot ? h('span', { class: 'badge__dot' }) : null),
    h('span', { text: label }));
}

export function tag(label) {
  return h('span', { class: 'tag', text: label });
}

export function avatar(text, { small = false } = {}) {
  return h('span', { class: ['avatar', small ? 'avatar--sm' : ''], 'aria-hidden': 'true', text });
}

/** Card with a header (title + optional actions) and a body slot. */
export function card({ title, subtitle, actions = [], body, flush = false, footer } = {}) {
  const bodyEl = h('div', { class: ['card__body', flush ? 'card__body--flush' : ''] }, body);
  const node = h('section', { class: 'card' },
    title ? h('header', { class: 'card__header' },
      h('div', { class: 'stack-2', style: { gap: '2px' } },
        h('h2', { class: 'card__title', text: title }),
        subtitle ? h('p', { class: 'card__subtitle', text: subtitle }) : null),
      actions.length ? h('div', { class: 'row-2', style: { 'margin-left': 'auto' } }, actions) : null) : null,
    bodyEl,
    footer ? h('footer', { class: 'card__footer' }, footer) : null);
  node.bodyEl = bodyEl;
  return node;
}

/** KPI tile. */
export function kpi({ label, value, hint, icon: iconName, tone = '' }) {
  return h('article', { class: 'kpi' },
    h('span', { class: ['kpi__icon', tone ? `kpi__icon--${tone}` : ''] }, icon(iconName || 'activity', { size: 20 })),
    h('div', { class: 'kpi__body' },
      h('p', { class: 'kpi__label', text: label }),
      h('p', { class: 'kpi__value', text: value }),
      hint ? h('p', { class: 'kpi__hint', text: hint }) : null));
}

/** Simple debounce used by search inputs. */
export function debounce(fn, wait = 200) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}
