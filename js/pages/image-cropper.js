/**
 * Image framing dialog for event covers.
 *
 * Shows the picture inside a 16:9 frame (the shape of the event cards) and
 * lets the administrator choose what is visible before it is uploaded:
 *   - drag the picture (mouse or finger) to move it;
 *   - zoom with the slider, the mouse wheel, or the + / − buttons;
 *   - "Llenar el marco" crops to fill the card, "Imagen completa" shows the
 *     whole picture with a blurred background, "Centrar" re-centres it;
 *   - keyboard: arrow keys move (Shift = faster), + and − zoom.
 * The preview is exactly what `renderEventImage()` will produce.
 *
 * Positions are kept in output pixels (1600 × 900) so preview and result
 * always match, whatever the size of the dialog.
 */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { button } from '../ui/controls.js';
import { openOverlay } from '../ui/overlay.js';
import { TARGET_HEIGHT, TARGET_WIDTH, defaultPlacement } from '../services/image-upload.js';

const MAX_ZOOM_OVER_COVER = 4;

/**
 * Pure framing maths, exported for tests.
 * `scale` is output pixels per picture pixel; `x`/`y` the top-left corner of
 * the picture in output pixels.
 */
export function createFraming(imageWidth, imageHeight, start) {
  const cover = Math.max(TARGET_WIDTH / imageWidth, TARGET_HEIGHT / imageHeight);
  const contain = Math.min(TARGET_WIDTH / imageWidth, TARGET_HEIGHT / imageHeight);
  const minScale = contain;
  const maxScale = Math.max(cover * MAX_ZOOM_OVER_COVER, contain * 2);

  let scale = start ? start.width / imageWidth : cover;
  let x = start ? start.x : 0;
  let y = start ? start.y : 0;

  function clampAxis(pos, drawn, frame) {
    // Bigger than the frame: no gap at either edge.
    if (drawn >= frame) return Math.min(0, Math.max(frame - drawn, pos));
    // Smaller: keep the whole picture inside the frame.
    return Math.max(0, Math.min(frame - drawn, pos));
  }

  function clamp() {
    scale = Math.min(maxScale, Math.max(minScale, scale));
    x = clampAxis(x, imageWidth * scale, TARGET_WIDTH);
    y = clampAxis(y, imageHeight * scale, TARGET_HEIGHT);
  }

  function center() {
    x = (TARGET_WIDTH - imageWidth * scale) / 2;
    y = (TARGET_HEIGHT - imageHeight * scale) / 2;
    clamp();
  }

  clamp();

  return {
    minScale,
    maxScale,
    coverScale: cover,
    containScale: contain,
    get scale() { return scale; },
    placement() {
      return { x, y, width: imageWidth * scale, height: imageHeight * scale };
    },
    moveBy(dx, dy) { x += dx; y += dy; clamp(); },
    /** Zoom keeping the output point (px, py) still; defaults to the centre. */
    zoomTo(nextScale, px = TARGET_WIDTH / 2, py = TARGET_HEIGHT / 2) {
      const target = Math.min(maxScale, Math.max(minScale, nextScale));
      const ratio = target / scale;
      x = px - (px - x) * ratio;
      y = py - (py - y) * ratio;
      scale = target;
      clamp();
    },
    fill() { scale = cover; center(); },
    whole() { scale = contain; center(); },
    center,
  };
}

/** Slider position (0–1000) <-> scale, on a log scale so zoom feels even. */
function sliderToScale(value, min, max) {
  return min * (max / min) ** (value / 1000);
}
function scaleToSlider(scale, min, max) {
  if (max <= min) return 0;
  return Math.round((Math.log(scale / min) / Math.log(max / min)) * 1000);
}

/**
 * Open the framing dialog.
 * @param {{source:CanvasImageSource, width:number, height:number}} image
 * @param {Blob|File} file The original file, used for the on-screen preview.
 * @param {{x:number,y:number,width:number,height:number}} [start] Framing to
 *        start from (e.g. the one chosen last time); defaults to the automatic one.
 * @returns {Promise<{x:number,y:number,width:number,height:number}|null>}
 *          The chosen placement in output pixels, or null if cancelled.
 */
export function openImageCropper(image, file, start) {
  return new Promise((resolve) => {
    const framing = createFraming(image.width, image.height, start || defaultPlacement(image.width, image.height));
    const objectUrl = URL.createObjectURL(file);
    let result = null;

    const backdrop = h('img', { class: 'cropper__backdrop', src: objectUrl, alt: '', draggable: false });
    const picture = h('img', { class: 'cropper__image', src: objectUrl, alt: '', draggable: false });
    const grid = h('div', { class: 'cropper__grid', 'aria-hidden': 'true' });
    const stage = h('div', {
      class: 'cropper__stage',
      tabindex: '0',
      role: 'application',
      'aria-label': 'Encuadre de la imagen. Arrastra para mover; usa las flechas para mover y + o − para acercar o alejar.',
    }, backdrop, picture, grid);

    const zoomSlider = h('input', {
      type: 'range',
      min: '0',
      max: '1000',
      step: '1',
      class: 'cropper__slider',
      'aria-label': 'Zoom',
    });
    const zoomOut = button({ label: '', ariaLabel: 'Alejar', title: 'Alejar', icon: 'minus', variant: 'ghost', size: 'sm', onClick: () => zoomStep(1 / 1.15) });
    const zoomIn = button({ label: '', ariaLabel: 'Acercar', title: 'Acercar', icon: 'plus', variant: 'ghost', size: 'sm', onClick: () => zoomStep(1.15) });

    const fillBtn = button({ label: 'Llenar el marco', variant: 'secondary', size: 'sm', onClick: () => { framing.fill(); render(); } });
    const wholeBtn = button({ label: 'Imagen completa', variant: 'secondary', size: 'sm', onClick: () => { framing.whole(); render(); } });
    const centerBtn = button({ label: 'Centrar', variant: 'ghost', size: 'sm', onClick: () => { framing.center(); render(); } });

    const status = h('p', { class: 'cropper__status', 'aria-live': 'polite' });

    const body = h('div', { class: 'cropper' },
      h('p', { class: 'text-sm text-secondary', text: 'Arrastra la imagen para elegir qué parte se ve y usa el zoom para acercarla o alejarla. El recuadro muestra exactamente cómo se verá en la tarjeta del evento (16:9).' }),
      stage,
      h('div', { class: 'cropper__zoom' }, icon('image', { size: 14 }), zoomOut, zoomSlider, zoomIn, icon('image', { size: 20 })),
      h('div', { class: 'cropper__actions' }, fillBtn, wholeBtn, centerBtn),
      status);

    const cancelBtn = button({ label: 'Cancelar', variant: 'secondary', onClick: () => overlay.close('cancel') });
    const useBtn = button({
      label: 'Usar esta imagen',
      variant: 'primary',
      icon: 'check',
      onClick: () => { result = framing.placement(); overlay.close('confirm'); },
    });

    const overlay = openOverlay({
      title: 'Ajustar imagen',
      subtitle: `Original: ${image.width} × ${image.height} px · Resultado: ${TARGET_WIDTH} × ${TARGET_HEIGHT} px`,
      variant: 'modal',
      size: 'lg',
      body,
      footer: [cancelBtn, useBtn],
      onClose: () => {
        URL.revokeObjectURL(objectUrl);
        resolve(result);
      },
    });

    function render() {
      const p = framing.placement();
      // Percentages of the 16:9 stage, so the preview scales with the dialog.
      picture.style.left = `${(p.x / TARGET_WIDTH) * 100}%`;
      picture.style.top = `${(p.y / TARGET_HEIGHT) * 100}%`;
      picture.style.width = `${(p.width / TARGET_WIDTH) * 100}%`;
      picture.style.height = `${(p.height / TARGET_HEIGHT) * 100}%`;
      zoomSlider.value = String(scaleToSlider(framing.scale, framing.minScale, framing.maxScale));

      const covers = p.x <= 0.5 && p.y <= 0.5 && p.x + p.width >= TARGET_WIDTH - 0.5 && p.y + p.height >= TARGET_HEIGHT - 0.5;
      backdrop.classList.toggle('hidden', covers);
      const shownW = Math.min(p.width, TARGET_WIDTH) / framing.scale;
      const shownH = Math.min(p.height, TARGET_HEIGHT) / framing.scale;
      const percent = Math.round(((shownW * shownH) / (image.width * image.height)) * 100);
      status.textContent = covers
        ? `Se muestra el ${percent} % de la imagen; el resto queda fuera de la tarjeta.`
        : 'Se muestra la imagen completa; los espacios libres se rellenan con un fondo difuminado.';
      const lowRes = framing.scale > 1.6;
      status.classList.toggle('is-warning', lowRes);
      if (lowRes) status.textContent += ' Con este zoom la imagen puede verse pixelada.';
    }

    function outputPerScreenPixel() {
      return TARGET_WIDTH / (stage.clientWidth || TARGET_WIDTH);
    }

    function zoomStep(factor, px, py) {
      framing.zoomTo(framing.scale * factor, px, py);
      render();
    }

    // ---- Drag to move ------------------------------------------------------
    let drag = null;
    stage.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      stage.focus();
      stage.setPointerCapture(event.pointerId);
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
      stage.classList.add('is-dragging');
    });
    stage.addEventListener('pointermove', (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      const k = outputPerScreenPixel();
      framing.moveBy((event.clientX - drag.x) * k, (event.clientY - drag.y) * k);
      drag.x = event.clientX;
      drag.y = event.clientY;
      render();
    });
    const endDrag = (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      drag = null;
      stage.classList.remove('is-dragging');
    };
    stage.addEventListener('pointerup', endDrag);
    stage.addEventListener('pointercancel', endDrag);

    // ---- Wheel to zoom around the pointer ---------------------------------
    stage.addEventListener('wheel', (event) => {
      event.preventDefault();
      const rect = stage.getBoundingClientRect();
      const k = outputPerScreenPixel();
      const px = (event.clientX - rect.left) * k;
      const py = (event.clientY - rect.top) * k;
      zoomStep(Math.exp(-event.deltaY * 0.0015), px, py);
    }, { passive: false });

    zoomSlider.addEventListener('input', () => {
      framing.zoomTo(sliderToScale(Number(zoomSlider.value), framing.minScale, framing.maxScale));
      render();
    });

    // ---- Keyboard ----------------------------------------------------------
    stage.addEventListener('keydown', (event) => {
      const step = event.shiftKey ? 80 : 16;
      const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (moves[event.key]) {
        event.preventDefault();
        framing.moveBy(...moves[event.key]);
        render();
      } else if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        zoomStep(1.1);
      } else if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        zoomStep(1 / 1.1);
      }
    });

    render();
    requestAnimationFrame(() => stage.focus());
  });
}
