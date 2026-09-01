/**
 * ping.js — ICMP reachability check using the system ping binary.
 * execFile (no shell) + strict host validation, so untrusted input cannot
 * inject commands.
 */
const { execFile } = require('child_process');

const HOST_RE = /^[a-zA-Z0-9.\-_:]+$/;

function ping(host, timeoutSec = 2) {
  return new Promise((resolve) => {
    if (!host || !HOST_RE.test(String(host))) {
      return resolve({ reachable: false, time_ms: null, timedOut: false, error: 'invalid host' });
    }
    const isWin = process.platform === 'win32';
    const args = isWin
      ? ['-n', '1', '-w', String(timeoutSec * 1000), host]
      : ['-c', '1', '-W', String(timeoutSec), host];

    execFile('ping', args, { timeout: (timeoutSec + 3) * 1000, windowsHide: true }, (err, stdout) => {
      const out = String(stdout || '');
      // TTL in the reply is the reliable success marker on both platforms —
      // Windows ping can exit 0 on "Destination host unreachable".
      const reachable = !err && /ttl[=<]/i.test(out);
      const m = out.match(/time[=<]\s*([\d.]+)\s*ms/i);
      // A real timeout (no reply at all within the window) is the default
      // failure mode — an active rejection (router/host says "unreachable",
      // or the name can't even be resolved) is a different, non-timeout
      // failure and is recognized by pattern instead.
      const activeRejection = /unreachable|could not find|unknown host|name or service not known/i.test(out);
      resolve({
        reachable,
        time_ms: reachable && m ? parseFloat(m[1]) : null,
        timedOut: !reachable && !activeRejection,
      });
    });
  });
}

module.exports = { ping };
