'use strict';

// Minimal HTTP router — no Express. ~60 lines including comments.
// Matches method + path pattern (with :param), extracts params + query.
// Registration order wins on overlap (register specific routes first).

function compile(pattern) {
  const paramNames = [];
  const regexSrc = pattern.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_, name) => {
    paramNames.push(name);
    return '([^/]+)';
  });
  return { regex: new RegExp('^' + regexSrc + '$'), paramNames };
}

function createRouter() {
  const routes = [];

  function register(method, pattern, handler) {
    const { regex, paramNames } = compile(pattern);
    routes.push({ method: method.toUpperCase(), regex, paramNames, handler, pattern });
  }

  function match(method, url) {
    const qIdx = url.indexOf('?');
    const pathPart = qIdx === -1 ? url : url.slice(0, qIdx);
    const queryStr = qIdx === -1 ? '' : url.slice(qIdx + 1);
    const query = new URLSearchParams(queryStr);
    const upMethod = method.toUpperCase();
    for (const r of routes) {
      if (r.method !== upMethod) continue;
      const m = pathPart.match(r.regex);
      if (!m) continue;
      const params = {};
      r.paramNames.forEach((n, i) => {
        try { params[n] = decodeURIComponent(m[i + 1]); }
        catch { params[n] = m[i + 1]; }
      });
      return { handler: r.handler, params, query, pattern: r.pattern };
    }
    return null;
  }

  return {
    get:    (p, h) => register('GET', p, h),
    post:   (p, h) => register('POST', p, h),
    put:    (p, h) => register('PUT', p, h),
    delete: (p, h) => register('DELETE', p, h),
    match,
    routes,
  };
}

module.exports = { createRouter };
