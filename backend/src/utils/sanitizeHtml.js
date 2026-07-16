const sanitizeHtml = require('sanitize-html');

// Branding footer_html is admin-authored but rendered with dangerouslySetInnerHTML
// on the public, unauthenticated login page (and the app footer for every logged-in
// user), so it must never be trusted verbatim. Restrict to a tiny inline-formatting
// allowlist — enough for "© {year} {tool} | Developed by ..." style text with a
// bold/italic word or a link — and nothing that can execute script, redirect the
// page (e.g. <meta http-equiv="refresh">), or load external resources.
const FOOTER_HTML_OPTIONS = {
  allowedTags: ['a', 'b', 'i', 'em', 'strong', 'u', 'sub', 'sup', 'small', 'span', 'br'],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowProtocolRelative: false,
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }),
  },
};

function sanitizeFooterHtml(html) {
  if (typeof html !== 'string' || !html) return html;
  return sanitizeHtml(html, FOOTER_HTML_OPTIONS);
}

module.exports = { sanitizeFooterHtml };
