/**
 * Branded confirmation dialogs.
 *
 * Replaces `window.confirm` / `window.prompt`: the item being acted on is named,
 * the consequence is spelled out, the destructive action is visually distinct
 * and both buttons are disabled while the operation runs.
 */
import { h, uid } from './dom.js';
import { icon } from './icons.js';
import { openOverlay } from './overlay.js';
import { button, setButtonLoading } from './controls.js';

/**
 * @param {object} options
 * @param {string} options.title
 * @param {string} options.message          Plain-language consequence.
 * @param {string} [options.itemLabel]      Name of the affected item.
 * @param {string} [options.confirmLabel='Confirmar']
 * @param {string} [options.cancelLabel='Cancelar']
 * @param {'danger'|'warning'|'info'} [options.tone='danger']
 * @param {string} [options.confirmationPhrase] When set, the confirm button
 *        stays disabled until the administrator types this phrase exactly.
 * @param {() => Promise<any>} [options.onConfirm] Awaited with the buttons in a
 *        loading state; the dialog closes only when it resolves.
 * @returns {Promise<boolean>} Resolves true when the action was confirmed.
 */
export function confirmDialog({
  title,
  message,
  itemLabel,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  tone = 'danger',
  confirmationPhrase = '',
  onConfirm,
} = {}) {
  return new Promise((resolve) => {
    let settled = false;

    const bodyNodes = [h('p', { class: 'text-secondary', text: message })];

    if (itemLabel) {
      bodyNodes.unshift(h('div', {
        class: 'card',
        style: { padding: '12px 16px', background: 'var(--surface-secondary)', 'margin-bottom': '16px' },
      }, h('p', { style: { 'font-weight': 'var(--weight-medium)', 'word-break': 'break-word' }, text: itemLabel })));
    }

    let phraseInput = null;
    if (confirmationPhrase) {
      const inputId = uid('confirm-phrase');
      phraseInput = h('input', { class: 'input', type: 'text', id: inputId, autocomplete: 'off' });
      bodyNodes.push(h('div', { class: 'field', style: { 'margin-top': '16px' } },
        h('label', { class: 'field__label', for: inputId },
          `Escribe `,
          h('strong', { text: confirmationPhrase }),
          ` para confirmar`),
        phraseInput));
    }

    const cancelBtn = button({
      label: cancelLabel,
      variant: 'secondary',
      onClick: () => { finish(false); },
    });

    const confirmBtn = button({
      label: confirmLabel,
      variant: tone === 'danger' ? 'danger' : 'primary',
      disabled: Boolean(confirmationPhrase),
    });

    confirmBtn.addEventListener('click', async () => {
      if (confirmBtn.disabled || confirmBtn.dataset.busy === '1') return;
      if (typeof onConfirm !== 'function') { finish(true); return; }

      setButtonLoading(confirmBtn, true);
      cancelBtn.disabled = true;
      overlay.setBusy(true);
      try {
        await onConfirm();
        finish(true);
      } catch (error) {
        // The caller reports the failure; keep the dialog open so the
        // administrator can retry or cancel.
        setButtonLoading(confirmBtn, false);
        cancelBtn.disabled = false;
        overlay.setBusy(false);
        if (error && error.__confirmClose) finish(false);
      }
    });

    if (phraseInput) {
      phraseInput.addEventListener('input', () => {
        confirmBtn.disabled = phraseInput.value.trim() !== confirmationPhrase;
      });
    }

    const overlay = openOverlay({
      title,
      body: bodyNodes,
      footer: [cancelBtn, confirmBtn],
      headerIcon: h('span', { class: ['overlay__icon', `overlay__icon--${tone}`] },
        icon(tone === 'danger' ? 'alert-triangle' : tone === 'warning' ? 'alert-circle' : 'info', { size: 20 })),
      onClose: () => { if (!settled) { settled = true; resolve(false); } },
    });

    function finish(result) {
      if (settled) return;
      settled = true;
      overlay.setBusy(false);
      overlay.close('confirm');
      resolve(result);
    }
  });
}

/** Shorthand for delete confirmations. */
export function confirmDelete({ itemLabel, message, confirmLabel = 'Eliminar', ...rest }) {
  return confirmDialog({
    title: '¿Eliminar definitivamente?',
    message: message || 'Esta acción no se puede deshacer.',
    itemLabel,
    confirmLabel,
    tone: 'danger',
    ...rest,
  });
}
