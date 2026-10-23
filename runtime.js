/* Pivolina – minimal standalone runtime for the prototype template.
   Supports {{dotted.lookups}}, <sc-for list as>, <sc-if value>, onX="{{fn}}" handlers,
   and a small React-like component class (state, setState, renderVals, lifecycle). */
(function () {
  'use strict';

  var VOID = { area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1, input: 1, link: 1, meta: 1, source: 1, track: 1, wbr: 1 };
  var HOLE = /\{\{\s*([^}]*?)\s*\}\}/g;

  function esc(v) {
    return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function lookup(expr, scopes) {
    if (expr === 'true') return true;
    if (expr === 'false') return false;
    if (expr === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(expr)) return Number(expr);
    var parts = expr.split('.');
    for (var i = scopes.length - 1; i >= 0; i--) {
      var s = scopes[i];
      if (s && Object.prototype.hasOwnProperty.call(s, parts[0])) {
        var v = s[parts[0]];
        for (var j = 1; j < parts.length && v != null; j++) v = v[parts[j]];
        return v;
      }
    }
    return undefined;
  }

  function single(str) {
    var m = /^\s*\{\{\s*([^}]*?)\s*\}\}\s*$/.exec(str);
    return m ? m[1] : null;
  }

  function interp(str, scopes) {
    return str.replace(HOLE, function (_, e) {
      var v = lookup(e, scopes);
      return v == null ? '' : String(v);
    });
  }

  function Renderer(root, component) {
    this.root = root;
    this.c = component;
    this.handlers = {};
    this.seq = 0;
  }

  Renderer.prototype.nodes = function (list, scopes, out) {
    for (var i = 0; i < list.length; i++) this.node(list[i], scopes, out);
  };

  Renderer.prototype.node = function (n, scopes, out) {
    if (n.nodeType === 3) { out.push(esc(interp(n.nodeValue, scopes))); return; }
    if (n.nodeType !== 1) return;
    var tag = n.localName;
    if (tag === 'sc-for') {
      var list = lookup(single(n.getAttribute('list')) || '', scopes) || [];
      var as = n.getAttribute('as') || 'item';
      for (var k = 0; k < list.length; k++) {
        var sc = {}; sc[as] = list[k]; sc[as + 'Index'] = k;
        this.nodes(n.childNodes, scopes.concat([sc]), out);
      }
      return;
    }
    if (tag === 'sc-if') {
      if (lookup(single(n.getAttribute('value')) || '', scopes)) this.nodes(n.childNodes, scopes, out);
      return;
    }
    var isSvg = n.namespaceURI === 'http://www.w3.org/2000/svg';
    out.push('<' + (isSvg ? n.tagName : tag));
    for (var a = 0; a < n.attributes.length; a++) {
      var at = n.attributes[a];
      var name = at.name;
      if (name.indexOf('hint-') === 0) continue;
      if (/^on[a-z]+$/i.test(name)) {
        var fn = lookup(single(at.value) || '', scopes);
        if (typeof fn === 'function') {
          var id = 'h' + (this.seq++);
          this.handlers[id] = fn;
          out.push(' data-pv-' + name.slice(2).toLowerCase() + '="' + id + '"');
        }
        continue;
      }
      out.push(' ' + name + '="' + esc(interp(at.value, scopes)) + '"');
    }
    out.push('>');
    if (!isSvg && VOID[tag]) return;
    var kids = tag === 'template' ? n.content.childNodes : n.childNodes;
    this.nodes(kids, scopes, out);
    out.push('</' + (isSvg ? n.tagName : tag) + '>');
  };

  Renderer.prototype.render = function (tpl) {
    this.handlers = {};
    this.seq = 0;
    var vals = this.c.renderVals();
    var out = [];
    this.nodes(tpl.childNodes, [this.c.props || {}, vals], out);
    var html = out.join('');
    if (!this.mounted || !window.morphdom) {
      this.root.innerHTML = html;
      this.mounted = true;
    } else {
      var next = this.root.cloneNode(false);
      next.innerHTML = html;
      window.morphdom(this.root, next, {
        onBeforeElUpdated: function (from, to) {
          if (from === document.activeElement && (from.tagName === 'INPUT' || from.tagName === 'TEXTAREA')) {
            to.value = from.value;
          }
          return true;
        }
      });
    }
  };

  window.DCLogic = function DCLogic(props) {
    this.props = props || {};
    this.state = {};
  };
  window.DCLogic.prototype.setState = function (patch) {
    var s = typeof patch === 'function' ? patch(this.state) : patch;
    this.state = Object.assign({}, this.state, s);
    if (this.__schedule) this.__schedule();
  };

  function boot() {
    var tpl = document.getElementById('pv-template');
    var root = document.getElementById('app');
    var script = document.querySelector('script[type="text/x-dc"]');
    var defs = {};
    try { defs = JSON.parse(script.getAttribute('data-props') || '{}'); } catch (e) {}
    var props = {};
    Object.keys(defs).forEach(function (k) { if (k.charAt(0) !== '$' && defs[k] && 'default' in defs[k]) props[k] = defs[k]['default']; });
    /* eslint-disable no-new-func */
    var Component = new Function('DCLogic', script.textContent + '\nreturn Component;')(window.DCLogic);
    var c = new Component(props);
    c.props = props;
    var r = new Renderer(root, c);
    var pending = false;
    c.__schedule = function () {
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () { pending = false; r.render(tpl.content); });
    };
    ['click', 'input', 'change', 'submit', 'keydown'].forEach(function (type) {
      root.addEventListener(type, function (ev) {
        var el = ev.target.closest ? ev.target.closest('[data-pv-' + type + ']') : null;
        if (!el || !root.contains(el)) return;
        var fn = r.handlers[el.getAttribute('data-pv-' + type)];
        if (fn) fn(ev);
      });
    });
    r.render(tpl.content);
    if (c.componentDidMount) c.componentDidMount();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
