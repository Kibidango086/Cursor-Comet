/**
 * Cursor Comet — buildJS()
 *
 * V3: Direction-aware tail. Each tail segment rotates to follow
 * cursor movement, extending opposite to the direction of travel.
 */

export interface CometConfig {
  tailMaxWidth: number;
  throttleMs: number;
  customColor: string;
}

export function buildJS(config: CometConfig): string {
  return `(function(){
if(window.__cometCursorInjected) return;
window.__cometCursorInjected = true;

var TAIL_MAX_W = ${config.tailMaxWidth};
var THROTTLE_MS = ${config.throttleMs};
var CUSTOM_C = "${config.customColor}";

/* ── INJECT STYLE ── */
var s = document.createElement('style');
s.textContent = \`
@keyframes _cc_blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.25; }
}
@keyframes _cc_tail {
  0% { opacity: 0.6; }
  100% { opacity: 0; }
}
._cc {
  position: absolute;
  pointer-events: none;
  z-index: 999999;
  transition: transform .12s cubic-bezier(.22,1,.36,1);
  animation: _cc_blink 1.2s ease-in-out infinite;
  will-change: transform;
}
._cct {
  position: absolute;
  pointer-events: none;
  z-index: 999998;
  animation: _cc_tail .18s ease-out forwards;
  will-change: opacity;
}
\`;
document.head.appendChild(s);

/* ── COLOR (reads VS Code theme CSS vars) ── */
function getColor() {
  if (CUSTOM_C !== "") return CUSTOM_C;
  var root = document.documentElement;
  var s = getComputedStyle(root);
  var c = s.getPropertyValue('--vscode-editorCursor-foreground').trim();
  if (c) return c;
  c = s.getPropertyValue('--vscode-editor-foreground').trim();
  if (c) return c;
  return '#ffffff';
}

function getDims(native) {
  var w = native.offsetWidth || 2;
  var h = native.offsetHeight || 20;
  if (w < 1) w = 2;
  if (w > 30) w = 2;
  if (h < 5) h = 20;
  if (h > 60) h = 20;
  return { w: w, h: h };
}

function relPos(el, parent) {
  var r = el.getBoundingClientRect();
  if (parent && parent !== document.body && parent !== document.documentElement) {
    var pr = parent.getBoundingClientRect();
    return { x: r.left - pr.left + r.width/2, y: r.top - pr.top + r.height/2 };
  }
  return { x: r.left + r.width/2, y: r.top + r.height/2 };
}

/* ── STATE ── */
var cursors = new Map();
var themeColor = '#ffffff';

/* ── MAIN LOOP ── */
function tick() {
  var all = document.querySelectorAll('[class*="cursor"]');
  var seen = new Set();

  for (var i = 0; i < all.length; i++) {
    var native = all[i];
    if (native.id === '__comet_caret' || native.classList.contains('_cc') || native.classList.contains('_cct')) continue;
    var r = native.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.width > 60 || r.height > 60) continue;

    var p = native.parentElement;
    if (!p) continue;
    seen.add(native);

    var pos = relPos(native, p);
    var dims = getDims(native);
    var cw = dims.w, ch = dims.h;
    var nx = pos.x - cw/2;
    var ny = pos.y - ch/2;

    if (!cursors.has(native)) {
      var color = getColor();
      themeColor = color;

      var caret = document.createElement('div');
      caret.id = '__comet_caret';
      caret.className = '_cc';
      caret.style.width = cw + 'px';
      caret.style.height = ch + 'px';
      caret.style.backgroundColor = color;
      caret.style.left = nx + 'px';
      caret.style.top = ny + 'px';
      p.appendChild(caret);

      native.style.setProperty('opacity', '0', 'important');

      cursors.set(native, {
        caret: caret, parent: p, cw: cw, ch: ch,
        lx: pos.x, ly: pos.y, lt: 0
      });
    } else {
      var st = cursors.get(native);
      var caret = st.caret;

      if (st.parent !== p) {
        if (caret.parentNode) caret.parentNode.removeChild(caret);
        p.appendChild(caret);
        st.parent = p;
        st.lx = pos.x; st.ly = pos.y; st.lt = 0;
      }

      if (st.cw !== cw || st.ch !== ch) {
        caret.style.width = cw + 'px';
        caret.style.height = ch + 'px';
        st.cw = cw; st.ch = ch;
      }

      caret.style.left = nx + 'px';
      caret.style.top = ny + 'px';

      /* ── TAIL (direction-aware) ── */
      var now = Date.now();
      if (now - st.lt >= THROTTLE_MS) {
        st.lt = now;
        var dx = pos.x - st.lx;
        var dy = pos.y - st.ly;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 2) {
          var tw = Math.min(dist, TAIL_MAX_W);
          var angle = Math.atan2(dy, dx);  // movement direction (rad)

          /* Tail div: positioned at cursor, rotates to point opposite movement */
          var t = document.createElement('div');
          t.className = '_cct';
          t.style.width = tw + 'px';
          t.style.height = ch + 'px';
          t.style.background = 'linear-gradient(to right, ' + getColor() + ', transparent)';
          t.style.left = pos.x + 'px';
          t.style.top = ny + 'px';
          t.style.transformOrigin = 'left center';
          t.style.transform = 'rotate(' + (angle + Math.PI) + 'rad)';
          p.appendChild(t);
          t.addEventListener('animationend', function() {
            if (this.parentNode) this.parentNode.removeChild(this);
          });
        }
        st.lx = pos.x;
        st.ly = pos.y;
      }
    }
  }

  /* Clean up stale cursors */
  for (var entry of cursors) {
    var nat = entry[0], st = entry[1];
    if (!seen.has(nat)) {
      if (st.caret && st.caret.parentNode) st.caret.parentNode.removeChild(st.caret);
      nat.style.removeProperty('opacity');
      cursors.delete(nat);
    }
  }

  requestAnimationFrame(tick);
}

/* ── Theme watcher ── */
var mo = new MutationObserver(function() {
  var nc = getColor();
  if (nc !== themeColor) {
    themeColor = nc;
    for (var entry of cursors) {
      entry[1].caret.style.backgroundColor = themeColor;
    }
  }
});
mo.observe(document.documentElement, { attributes: true, childList: true, subtree: true });

requestAnimationFrame(tick);
})();`;
}
