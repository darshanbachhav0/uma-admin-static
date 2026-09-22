/**
 * Minimal SVG charts.
 *
 * Hand-rolled instead of pulling in a charting library: the dashboard needs one
 * bar chart and one distribution meter, both of which theme correctly from the
 * design tokens and add no runtime dependency to a static site.
 */
import { h } from './dom.js';
import { formatNumber } from '../utils/format.js';

const NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== null && value !== undefined) node.setAttribute(key, String(value));
  }
  return node;
}

function svgText(value, attrs) {
  const node = svgEl('text', attrs);
  node.textContent = value;
  return node;
}

/**
 * Responsive bar chart.
 * @param {{data: Array<{label:string, value:number}>, height?:number, ariaLabel?:string}} options
 */
export function barChart({ data, height = 220, ariaLabel = 'Gráfico de barras' }) {
  const width = 640;
  const padding = { top: 16, right: 8, bottom: 28, left: 40 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const max = Math.max(1, ...data.map((d) => d.value));
  const niceMax = niceCeiling(max);
  const slot = plotWidth / Math.max(1, data.length);
  const barWidth = Math.min(48, slot * 0.58);

  const svg = svgEl('svg', {
    class: 'chart',
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
    'aria-label': `${ariaLabel}. ${data.map((d) => `${d.label}: ${d.value}`).join('. ')}`,
  });

  // Horizontal grid + y axis labels
  const ticks = 4;
  for (let i = 0; i <= ticks; i += 1) {
    const value = (niceMax / ticks) * i;
    const y = padding.top + plotHeight - (value / niceMax) * plotHeight;
    svg.appendChild(svgEl('line', {
      class: 'chart__grid',
      x1: padding.left, x2: width - padding.right, y1: y, y2: y,
    }));
    svg.appendChild(svgText(formatNumber(Math.round(value)), {
      class: 'chart__axis-label',
      x: padding.left - 8,
      y: y + 4,
      'text-anchor': 'end',
    }));
  }

  data.forEach((point, index) => {
    const barHeight = niceMax === 0 ? 0 : (point.value / niceMax) * plotHeight;
    const x = padding.left + index * slot + (slot - barWidth) / 2;
    const y = padding.top + plotHeight - barHeight;

    const rect = svgEl('rect', {
      class: 'chart__bar',
      x, y: point.value === 0 ? padding.top + plotHeight - 2 : y,
      width: barWidth,
      height: point.value === 0 ? 2 : Math.max(2, barHeight),
      rx: 4,
    });
    const title = svgEl('title');
    title.textContent = `${point.label}: ${formatNumber(point.value)}`;
    rect.appendChild(title);
    svg.appendChild(rect);

    if (point.value > 0) {
      svg.appendChild(svgText(formatNumber(point.value), {
        class: 'chart__value-label',
        x: x + barWidth / 2,
        y: y - 5,
        'text-anchor': 'middle',
      }));
    }

    svg.appendChild(svgText(point.label, {
      class: 'chart__axis-label',
      x: x + barWidth / 2,
      y: height - 8,
      'text-anchor': 'middle',
    }));
  });

  return svg;
}

function niceCeiling(value) {
  if (value <= 5) return 5;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
}

/**
 * Distribution meter with a legend — used for the event status breakdown.
 * @param {{segments: Array<{label:string, value:number, color:string}>}} options
 */
export function distribution({ segments }) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);

  const meter = h('div', {
    class: 'meter',
    role: 'img',
    'aria-label': segments.map((s) => `${s.label}: ${s.value}`).join(', '),
  });

  for (const segment of segments) {
    if (!segment.value) continue;
    meter.appendChild(h('span', {
      class: 'meter__part',
      style: { width: `${(segment.value / total) * 100}%`, background: segment.color },
      title: `${segment.label}: ${segment.value}`,
    }));
  }
  if (!total) {
    meter.appendChild(h('span', { class: 'meter__part', style: { width: '100%', background: 'var(--surface-hover)' } }));
  }

  const legend = h('ul', { class: 'legend' },
    ...segments.map((segment) => h('li', { class: 'legend__item' },
      h('span', { class: 'legend__swatch', style: { background: segment.color } }),
      h('span', { class: 'legend__label', text: segment.label }),
      h('span', { class: 'legend__value', text: formatNumber(segment.value) }))));

  return h('div', { class: 'stack' }, meter, legend);
}
