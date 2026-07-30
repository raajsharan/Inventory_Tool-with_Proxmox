// navigator.clipboard requires a secure context (HTTPS or localhost) — it's
// undefined (or writeText rejects) when the app is reached over plain HTTP
// on a LAN IP/hostname, which is common for internal tools. Fall back to
// the older execCommand('copy') path (via a hidden textarea) in that case.
export async function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // fall through to the execCommand fallback below
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = text ?? '';
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    const ok = document.execCommand('copy');
    if (!ok) throw new Error('execCommand copy failed');
  } finally {
    document.body.removeChild(textarea);
  }
}
