/**
 * TextAnimator.js v1.2.0 - After Effects-style text animations for the web
 *
 * Selectors: letter | word | line | all
 * Orders:    forward | backward | random | from-center | to-center
 *
 * Usage:
 *   TextAnimator.animate({ target: '#title', selector: 'word' })
 *   const anim = new TextAnimator({ target: '#title', selector: 'letter' })
 *   anim.play() / anim.reverse() / anim.seek(0.5) / anim.stop()
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define(factory);
  } else {
    root.TextAnimator = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const DEFAULTS = {
    selector: 'word',
    order: 'forward',
    from: {
      opacity: 0, x: 0, y: 40, scale: 1, scaleX: null, scaleY: null,
      rotate: 0, rotateX: 0, rotateY: 0, skewX: 0, skewY: 0,
      blur: 0, brightness: 1, contrast: 1, saturate: 1,
      color: null, letterSpacing: null, wordSpacing: null,
    },
    to: null,
    duration: 600,
    stagger: 80,
    delay: 0,
    easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    loop: 'none',
    loopDelay: 0,
    onStart: null,
    onComplete: null,
    onLoop: null,
    perspective: 600,
    splitOptions: {
      preserveSpaces: true,
      wrapLines: false,
      lineBreakChar: '\n',
    },
  };

  const EASINGS = {
    'linear': 'linear',
    'ease': 'ease',
    'ease-in': 'cubic-bezier(0.4, 0, 1, 1)',
    'ease-out': 'cubic-bezier(0, 0, 0.2, 1)',
    'ease-in-out': 'cubic-bezier(0.4, 0, 0.2, 1)',
    'ease-out-quint': 'cubic-bezier(0.22, 1, 0.36, 1)',
    'ease-out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
    'ease-out-back': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
    'ease-in-back': 'cubic-bezier(0.36, 0, 0.66, -0.56)',
    'spring': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
    'bounce': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
    'steps(1)': 'steps(1)',
    'steps(2)': 'steps(2)',
    'steps(4)': 'steps(4)',
    'steps(8)': 'steps(8)',
    'steps(16)': 'steps(16)',
  };

  const PRESETS = {
    'fade-up':    { from: { opacity: 0, y: 40 } },
    'fade-down':  { from: { opacity: 0, y: -40 } },
    'fade-left':  { from: { opacity: 0, x: 40 } },
    'fade-right': { from: { opacity: 0, x: -40 } },
    'fade-in':    { from: { opacity: 0 } },
    'slide-up':   { from: { y: 60 }, easing: 'ease-out-expo' },
    'slide-down': { from: { y: -60 } },
    'slide-left': { from: { x: 80 } },
    'slide-right':{ from: { x: -80 } },
    'scale-up':   { from: { opacity: 0, scale: 0 }, easing: 'spring' },
    'scale-down': { from: { opacity: 0, scale: 2 } },
    'rotate-in':  { from: { opacity: 0, rotate: -90, scale: 0.8, y: 20 } },
    'rotate-out': { from: { opacity: 1 }, to: { opacity: 0, rotate: 90, scale: 0.8 } },
    'flip-x':     { from: { opacity: 0, rotateX: 90 }, perspective: 800 },
    'flip-y':     { from: { opacity: 0, rotateY: -90 }, perspective: 800 },
    'blur-in':    { from: { opacity: 0, blur: 20 } },
    'blur-out':   { from: { opacity: 1, blur: 0 }, to: { opacity: 0, blur: 20 } },
    'skew-in':    { from: { opacity: 0, skewX: 30, x: 40 } },
    'typewriter': { from: { opacity: 0 }, selector: 'letter', easing: 'steps(1)', stagger: 60 },
    'wave':       { from: { y: -20 }, selector: 'letter', stagger: 60, easing: 'ease-out-back' },
    'bounce-in':  { from: { opacity: 0, y: -80 }, easing: 'spring', stagger: 60 },
    'zoom-in':    { from: { opacity: 0, scale: 0.5 }, easing: 'spring' },
    'clip-up':    { from: { y: 100, opacity: 0 }, easing: 'ease-out-expo', duration: 800 },
    'clip-right': { from: { x: -100, opacity: 0 }, easing: 'ease-out-expo', duration: 800 },
    'glow-in':    { from: { opacity: 0, blur: 30, scale: 1.1 } },
    'shake':      { from: { x: -10 }, to: { x: 0 }, easing: 'ease-in-out', stagger: 20, duration: 200 },
  };

  function deepMerge(target, source) {
    const out = Object.assign({}, target);
    for (const key in source) {
      if (source[key] !== null && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        out[key] = deepMerge(target[key] || {}, source[key]);
      } else if (source[key] !== undefined) {
        out[key] = source[key];
      }
    }
    return out;
  }

  function resolveEl(target) {
    if (typeof target === 'string') return document.querySelector(target);
    if (target instanceof Element) return target;
    return null;
  }

  function resolveEasing(val) {
    return EASINGS[val] || val;
  }

  function buildTransform(from) {
    const parts = [];
    if (from.x !== 0) parts.push(`translateX(${from.x}px)`);
    if (from.y !== 0) parts.push(`translateY(${from.y}px)`);
    if (from.scale !== 1) {
      const sx = from.scaleX !== null ? from.scaleX : from.scale;
      const sy = from.scaleY !== null ? from.scaleY : from.scale;
      parts.push(`scale(${sx}, ${sy})`);
    }
    if (from.rotate !== 0) parts.push(`rotate(${from.rotate}deg)`);
    if (from.rotateX !== 0) parts.push(`rotateX(${from.rotateX}deg)`);
    if (from.rotateY !== 0) parts.push(`rotateY(${from.rotateY}deg)`);
    if (from.skewX !== 0) parts.push(`skewX(${from.skewX}deg)`);
    if (from.skewY !== 0) parts.push(`skewY(${from.skewY}deg)`);
    return parts.join(' ') || 'none';
  }

  function buildFilter(from) {
    const parts = [];
    if (from.blur > 0) parts.push(`blur(${from.blur}px)`);
    if (from.brightness !== 1) parts.push(`brightness(${from.brightness})`);
    if (from.contrast !== 1) parts.push(`contrast(${from.contrast})`);
    if (from.saturate !== 1) parts.push(`saturate(${from.saturate})`);
    return parts.join(' ') || '';
  }

  function getOrderedIndices(order, total) {
    const idx = Array.from({ length: total }, (_, i) => i);
    switch (order) {
      case 'backward': return idx.reverse();
      case 'random': return idx.sort(() => Math.random() - 0.5);
      case 'from-center': {
        const mid = (total - 1) / 2;
        return idx.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid));
      }
      case 'to-center': {
        const mid = (total - 1) / 2;
        return idx.sort((a, b) => Math.abs(b - mid) - Math.abs(a - mid));
      }
      default: return idx;
    }
  }

  function splitText(el, selector, opts) {
    const text = el.textContent;
    el.innerHTML = '';
    el.style.visibility = 'visible';
    const units = [];

    const wrap = (content, tag = 'span') => {
      const s = document.createElement(tag);
      s.className = 'ta-unit';
      s.style.display = 'inline-block';
      s.style.whiteSpace = 'pre';
      s.textContent = content;
      return s;
    };

    if (selector === 'all') {
      const s = wrap(text);
      el.appendChild(s);
      units.push(s);
    } else if (selector === 'letter') {
      const chars = opts.lineBreakChar
        ? [...text].reduce((acc, ch) => {
            if (ch === opts.lineBreakChar) acc.push({ type: 'br' });
            else acc.push({ type: 'char', value: ch });
            return acc;
          }, [])
        : [...text].map(ch => ({ type: 'char', value: ch }));

      chars.forEach(item => {
        if (item.type === 'br') {
          el.appendChild(document.createElement('br'));
        } else if (item.value === ' ' && opts.preserveSpaces) {
          el.appendChild(document.createTextNode(' '));
        } else {
          const s = wrap(item.value);
          el.appendChild(s);
          units.push(s);
        }
      });
    } else if (selector === 'word') {
      const words = text.split(' ');
      words.forEach((word, i) => {
        if (i > 0 && opts.preserveSpaces) el.appendChild(document.createTextNode(' '));
        const s = wrap(word);
        el.appendChild(s);
        units.push(s);
      });
    } else if (selector === 'line') {
      const lines = text.includes('\n') ? text.split('\n') : null;
      if (lines) {
        lines.forEach((line, i) => {
          if (i > 0) el.appendChild(document.createElement('br'));
          const s = wrap(line);
          s.style.display = 'block';
          el.appendChild(s);
          units.push(s);
        });
      } else {
        const wordList = text.split(' ');
        const half = Math.ceil(wordList.length / 2);
        [wordList.slice(0, half).join(' '), wordList.slice(half).join(' ')].forEach((line, i) => {
          if (i > 0) el.appendChild(document.createElement('br'));
          const s = wrap(line);
          s.style.display = 'block';
          el.appendChild(s);
          units.push(s);
        });
      }
    }

    return units;
  }

  function calcDuration(opts) {
    const count = opts._unitCount || 1;
    return opts.delay + opts.stagger * (count - 1) + opts.duration;
  }

  class TextAnimator {
    constructor(options = {}) {
      let presetOpts = {};
      if (options.preset && PRESETS[options.preset]) presetOpts = PRESETS[options.preset];
      this.options = deepMerge(deepMerge(DEFAULTS, presetOpts), options);
      this.options.from = deepMerge(deepMerge(DEFAULTS.from, presetOpts.from || {}), options.from || {});
      this._el = resolveEl(this.options.target);
      if (!this._el) throw new Error(`TextAnimator: target "${this.options.target}" not found`);
      this._units = [];
      this._timers = [];
      this._loopTimer = null;
      this._playing = false;
      this._direction = 'forward';
      this._originalHTML = this._el.innerHTML;
      this._init();
    }

    _init() {
      const { selector, splitOptions, perspective } = this.options;
      const opts = deepMerge(DEFAULTS.splitOptions, splitOptions || {});
      if (perspective && (this.options.from.rotateX !== 0 || this.options.from.rotateY !== 0)) {
        this._el.style.perspective = perspective + 'px';
      }
      this._units = splitText(this._el, selector, opts);
      this.options._unitCount = this._units.length;
      this._applyFromState();
    }

    _applyFromState() {
      const f = this.options.from;
      this._units.forEach(u => {
        u.style.transition = 'none';
        u.style.opacity = f.opacity;
        u.style.transform = buildTransform(f);
        u.style.filter = buildFilter(f);
        if (f.color) u.style.color = f.color;
        if (f.letterSpacing !== null && f.letterSpacing !== undefined)
          u.style.letterSpacing = f.letterSpacing;
        if (f.wordSpacing !== null && f.wordSpacing !== undefined)
          u.style.wordSpacing = f.wordSpacing;
        void u.offsetWidth;
      });
    }

    _applyToState(units, transition) {
      const to = this.options.to || {};
      const zeroFrom = { x: 0, y: 0, scale: 1, scaleX: null, scaleY: null, rotate: 0, rotateX: 0, rotateY: 0, skewX: 0, skewY: 0 };
      units.forEach(u => {
        u.style.transition = transition;
        u.style.opacity = to.opacity !== undefined ? to.opacity : 1;
        u.style.transform = (to.x || to.y || to.scale || to.rotate || to.skewX)
          ? buildTransform(deepMerge(zeroFrom, to))
          : 'none';
        u.style.filter = '';
        if (to.color) u.style.color = to.color;
        if (to.letterSpacing !== undefined) u.style.letterSpacing = to.letterSpacing;
        if (to.wordSpacing !== undefined) u.style.wordSpacing = to.wordSpacing;
      });
    }

    _clearTimers() {
      this._timers.forEach(clearTimeout);
      this._timers = [];
      if (this._loopTimer) {
        clearTimeout(this._loopTimer);
        this._loopTimer = null;
      }
    }

    _schedule(fn, delay) {
      const t = setTimeout(fn, delay);
      this._timers.push(t);
      return t;
    }

    play(direction = 'forward') {
      this._clearTimers();
      this._direction = direction;
      this._playing = true;
      const { duration, stagger, delay, easing, loop, loopDelay, order, from, onStart, onComplete, onLoop } = this.options;
      const easingValue = resolveEasing(easing);
      const transition = `opacity ${duration}ms ${easingValue}, transform ${duration}ms ${easingValue}, filter ${duration}ms ${easingValue}, color ${duration}ms ${easingValue}, letter-spacing ${duration}ms ${easingValue}`;
      const total = this._units.length;
      const orderedIdx = getOrderedIndices(order, total);
      const isReverse = direction === 'reverse';

      if (isReverse) this._applyToState(this._units, 'none');
      else this._applyFromState();

      if (onStart) this._schedule(() => onStart(this), delay);

      const totalAnimTime = delay + stagger * (total - 1) + duration;

      orderedIdx.forEach((unitIdx, staggerIdx) => {
        const t = delay + staggerIdx * stagger;
        this._schedule(() => {
          const u = this._units[unitIdx];
          if (isReverse) {
            u.style.transition = transition;
            u.style.opacity = from.opacity;
            u.style.transform = buildTransform(from);
            u.style.filter = buildFilter(from);
            if (from.color) u.style.color = from.color;
          } else {
            this._applyToState([u], transition);
          }
        }, t);
      });

      this._schedule(() => {
        this._playing = false;
        if (onComplete) onComplete(this);
        if (loop === 'loop') {
          this._loopTimer = setTimeout(() => { if (onLoop) onLoop(this); this.play('forward'); }, loopDelay);
        } else if (loop === 'alternate') {
          const nextDir = isReverse ? 'forward' : 'reverse';
          this._loopTimer = setTimeout(() => { if (onLoop) onLoop(this); this.play(nextDir); }, loopDelay);
        } else if (loop === 'yoyo') {
          this._loopTimer = setTimeout(() => { if (onLoop) onLoop(this); this.play('reverse'); }, loopDelay);
        }
      }, totalAnimTime);

      return this;
    }

    forward() { return this.play('forward'); }
    reverse() { return this.play('reverse'); }
    start() { return this.play('forward'); }

    stop() {
      this._clearTimers();
      this._playing = false;
      return this;
    }

    seek(progress) {
      this._clearTimers();
      const { duration, stagger, delay, from, order } = this.options;
      const total = this._units.length;
      const orderedIdx = getOrderedIndices(order, total);
      const totalTime = delay + stagger * (total - 1) + duration;
      const currentTime = progress * totalTime;

      orderedIdx.forEach((unitIdx, staggerIdx) => {
        const unitStart = delay + staggerIdx * stagger;
        const unitEnd = unitStart + duration;
        const u = this._units[unitIdx];
        u.style.transition = 'none';

        if (currentTime <= unitStart) {
          u.style.opacity = from.opacity;
          u.style.transform = buildTransform(from);
          u.style.filter = buildFilter(from);
        } else if (currentTime >= unitEnd) {
          u.style.opacity = 1;
          u.style.transform = 'none';
          u.style.filter = '';
        } else {
          const t = (currentTime - unitStart) / duration;
          u.style.opacity = from.opacity + t * (1 - from.opacity);
          u.style.transform = `translateY(${from.y * (1 - t)}px) translateX(${from.x * (1 - t)}px)`;
        }
      });
      return this;
    }

    reset() {
      this._clearTimers();
      this._applyFromState();
      return this;
    }

    setText(newText) {
      this._clearTimers();
      this._el.textContent = newText;
      this._init();
      return this;
    }

    set(newOptions) {
      const wasPlaying = this._playing;
      this.stop();
      this.options = deepMerge(this.options, newOptions);
      if (newOptions.from) this.options.from = deepMerge(this.options.from, newOptions.from);
      this._init();
      if (wasPlaying) this.play();
      return this;
    }

    destroy() {
      this._clearTimers();
      this._el.innerHTML = this._originalHTML;
      this._el.style.perspective = '';
    }

    get isPlaying() { return this._playing; }
    get units() { return this._units; }
    get totalDuration() {
      const { duration, stagger, delay } = this.options;
      return delay + stagger * (this._units.length - 1) + duration;
    }
  }

  TextAnimator.animate = function (options) {
    const anim = new TextAnimator(options);
    anim.play();
    return anim;
  };

  TextAnimator.presets = PRESETS;
  TextAnimator.easings = EASINGS;
  TextAnimator.version = '1.2.0';

  class Timeline {
    constructor(opts = {}) {
      this._queue = [];
      this._opts = opts;
    }

    add(options, offsetMs = 0) {
      this._queue.push({ options, offsetMs });
      return this;
    }

    play() {
      let cursor = 0;
      this._queue.forEach(({ options, offsetMs }) => {
        cursor += offsetMs;
        const delay = cursor;
        setTimeout(() => {
          const anim = new TextAnimator(options);
          anim.play();
        }, delay);
        const tmpEl = resolveEl(options.target);
        if (tmpEl) {
          const unitCount = (tmpEl.textContent || '').split(options.selector === 'word' ? ' ' : '').length || 1;
          const dur = (options.delay || 0) + (options.stagger || 80) * (unitCount - 1) + (options.duration || 600);
          cursor += dur;
        }
      });
      return this;
    }
  }

  TextAnimator.Timeline = Timeline;

  return TextAnimator;
});
