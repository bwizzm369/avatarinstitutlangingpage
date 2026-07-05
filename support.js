/**
 * DC runtime — template binding for .dc.html single-page apps.
 * Replaces {{ key }} placeholders with values from renderVals().
 */
class DCLogic {
  constructor(root) {
    this._root = root || null;
    this._bindings = [];
    this._mounted = false;
    if (!this.state) this.state = {};
  }

  setState(partial) {
    Object.assign(this.state, partial);
    this._applyBindings();
  }

  /** Match a node whose entire content is a single {{ key }} placeholder. */
  static _parsePlaceholder(text) {
    if (text == null) return null;
    const m = String(text).match(/^\s*\{\{\s*([\w$]+)\s*\}\}\s*$/);
    return m ? m[1] : null;
  }

  _collectBindings(node) {
    if (!node) return;

    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent;
      const key = DCLogic._parsePlaceholder(text);
      if (key) {
        this._bindings.push({ type: 'text', node, key });
      } else if (/\{\{\s*[\w$]+\s*\}\}/.test(text)) {
        // Mixed text + placeholders, e.g. "↑ 12% {{ kpiThisMonth }}"
        this._bindings.push({ type: 'inline', node, template: text });
      }
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE') return;

    for (const attr of node.attributes) {
      const key = DCLogic._parsePlaceholder(attr.value);
      if (key) this._bindings.push({ type: 'attr', node, attr: attr.name, key });
    }

    for (const child of node.childNodes) {
      this._collectBindings(child);
    }
  }

  _applyBindings() {
    if (!this._bindings.length || typeof this.renderVals !== 'function') return;

    let vals;
    try {
      vals = this.renderVals();
    } catch (err) {
      console.error('[DC] renderVals() failed:', err);
      return;
    }

    for (const b of this._bindings) {
      const val = vals[b.key];

      if (b.type === 'text') {
        b.node.textContent = val != null ? String(val) : '';
        continue;
      }

      if (b.type === 'inline') {
        b.node.textContent = b.template.replace(
          /\{\{\s*([\w$]+)\s*\}\}/g,
          (_, key) => {
            const v = vals[key];
            return v != null ? String(v) : '';
          }
        );
        continue;
      }

      if (b.type !== 'attr') continue;

      if ((b.attr === 'onclick' || b.attr === 'onsubmit') && typeof val === 'function') {
        b.node[b.attr] = val;
      } else if (b.attr === 'class') {
        b.node.className = val != null ? String(val) : '';
      } else {
        b.node.setAttribute(b.attr, val != null ? String(val) : '');
      }
    }
  }

  mount() {
    if (!this._root) return;
    this._bindings = [];
    this._collectBindings(this._root);
    this._applyBindings();

    if (!this._mounted) {
      this._mounted = true;
      if (typeof this.componentDidMount === 'function') {
        this.componentDidMount();
      }
    }
  }
}

// Ensure DCLogic is reachable from dynamically compiled components.
window.DCLogic = DCLogic;

function injectHelmet(xdc) {
  const helmet = xdc.querySelector('helmet[data-dc-atomics]');
  if (!helmet) return;

  for (const child of [...helmet.children]) {
    const tag = child.tagName;
    if (tag === 'TITLE') {
      document.title = child.textContent;
    } else if (tag === 'META') {
      const name = child.getAttribute('name') || child.getAttribute('property');
      const existing = name
        ? document.head.querySelector(`meta[name="${name}"], meta[property="${name}"]`)
        : null;
      if (existing) existing.replaceWith(child.cloneNode(true));
      else document.head.appendChild(child.cloneNode(true));
    } else {
      document.head.appendChild(child.cloneNode(true));
    }
  }
  helmet.remove();
}

function bootDC() {
  if (window.__dcBooted) return;

  const xdc = document.querySelector('x-dc');
  if (!xdc) {
    console.warn('[DC] No <x-dc> root element found.');
    return;
  }

  injectHelmet(xdc);

  const scriptEl =
    xdc.querySelector('script[type="text/x-dc"][data-dc-script]') ||
    document.querySelector('script[type="text/x-dc"][data-dc-script]');

  if (!scriptEl) {
    console.warn('[DC] No component script found.');
    return;
  }

  const code = scriptEl.textContent;
  scriptEl.remove();

  let ComponentClass;
  try {
    // DCLogic MUST be injected — it is not reliably in scope inside new Function().
    ComponentClass = new Function('DCLogic', `${code}\nreturn Component;`)(DCLogic);
  } catch (err) {
    console.error('[DC] Failed to compile Component:', err);
    return;
  }

  if (typeof ComponentClass !== 'function') {
    console.error('[DC] Component script did not export a class.');
    return;
  }

  let instance;
  try {
    instance = new ComponentClass();
  } catch (err) {
    console.error('[DC] Failed to instantiate Component:', err);
    return;
  }

  instance._root = xdc;
  if (!instance.state) instance.state = {};

  instance.mount();

  window.__dcInstance = instance;
  window.__dcBooted = true;
}

function startDC() {
  if (document.querySelector('x-dc')) {
    bootDC();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startDC);
} else {
  startDC();
}
