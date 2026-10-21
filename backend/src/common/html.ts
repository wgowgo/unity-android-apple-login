export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function page(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="referrer" content="no-referrer" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; background: #f5f5f7; color: #1d1d1f; }
    main { max-width: 28rem; margin: 12vh auto; background: white; padding: 2rem; border-radius: 16px; }
    a, button { display: block; width: 100%; margin-top: 0.75rem; text-align: center; background: #111; color: white; padding: 0.85rem 1rem; border-radius: 10px; text-decoration: none; border: 0; font-size: 1rem; }
    p { line-height: 1.5; }
  </style>
</head>
<body><main>${body}</main></body>
</html>`;
}
