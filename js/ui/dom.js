/**
 * Safe DOM construction helpers.
 *
 * Every node in this application is built with `createElement` + `textContent`
 * so that values coming from the database can never be interpreted as HTML.
 * There is deliberately no `innerHTML` escape hatch here: the only place that
 * assigns markup is `icons.js`, with static strings authored in this repo.
 */

/**
 * Create an element.
 *
 * @param {string} tag                       Tag name.
 * @param {object|string|Node|Array} [props] Attributes/props, or children when
 *                                           a string/Node/Array is passed.
 * @param {...(string|Node|Array|null)} children
 * @returns {HTMLElement}
 */
export function h(tag, props, ...children) {
  const node = document.createElement(tag);

  if (props && (typeof props === 'string' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }

  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;

      if (key === 'class') {
        node.className = Array.isArray(value) ? value.filter(Boolean).join(' ') : String(value);
      } else if (key === 'dataset') {
        for (const [dk, dv] of Object.entries(value)) {
          if (dv !== null && dv !== undefined) node.dataset[dk] = String(dv);
        }
      } else if (key === 'style' && typeof value === 'object') {
        for (const [sk, sv] of Object.entries(value)) node.style.setProperty(sk, sv);
      } else if (key === 'text') {
        node.textContent = String(value);
      } else if (key.startsWith('on') && typeof value === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (key in node && key !== 'list' && typeof value !== 'object') {
        try { node[key] = value; } catch { node.setAttribute(key, String(value)); }
      } else {
        node.setAttribute(key, value === true ? '' : String(value));
      }
    }
  }

  appendChildren(node, children);
  return node;
}

/** Append a nested array of children, skipping nullish entries. */
export function appendChildren(parent, children) {
  for (const child of children.flat(4)) {
    if (child === null || child === undefined || child === false || child === '') continue;
    parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

/** Replace all children of `parent` with `children`. */
export function replaceChildren(parent, ...children) {
  parent.textContent = '';
  appendChildren(parent, children);
  return parent;
}

/** Create a document fragment from children. */
export function fragment(...children) {
  return appendChildren(document.createDocumentFragment(), children);
}

export const qs = (selector, root = document) => root.querySelector(selector);
export const qsa = (selector, root = document) => Array.from(root.querySelectorAll(selector));

/** Toggle a class and return the element. */
export function toggleClass(node, className, on) {
  node.classList.toggle(className, on);
  return node;
}

/** Monotonic ids for label/control wiring. */
let idCounter = 0;
export function uid(prefix = 'uma') {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

/**
 * Attach a listener and return a disposer. Used so pages can tear down
 * everything they registered when the router unmounts them.
 */
export function on(target, type, handler, options) {
  target.addEventListener(type, handler, options);
  return () => target.removeEventListener(type, handler, options);
}
