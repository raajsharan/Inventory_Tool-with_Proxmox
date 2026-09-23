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

    execFile('ping', args, { timeout: (timeoutSec + 3) * 1000, windowsHide: true }, (err, stdout, stderr) => {
      const out = String(stdout || '');
      const errOut = String(stderr || '').trim();
      // TTL in the reply is the reliable success marker on both platforms —
      // Windows ping can exit 0 on "Destination host unreachable".
      const reachable = !err && /ttl[=<]/i.test(out);
      const m = out.match(/time[=<]\s*([\d.]+)\s*ms/i);
      // A real timeout (no reply at all within the window) is the default
      // failure mode — an active rejection (router/host says "unreachable",
      // or the name can't even be resolved) is a different, non-timeout
      // failure and is recognized by pattern instead.
      const activeRejection = /unreachable|could not find|unknown host|name or service not known/i.test(out);
      // Failing to even run the probe is not the same as a host that didn't
      // answer, and reporting both as a bare "no reply" hides real setup
      // problems — e.g. the service's gid missing from
      // net.ipv4.ping_group_range, which makes ping exit with
      // "socket: Operation not permitted" against a perfectly reachable host.
      const probeFailed = !reachable && (err?.code === 'ENOENT' || !!errOut);
      resolve({
        reachable,
        time_ms: reachable && m ? parseFloat(m[1]) : null,
        timedOut: !reachable && !activeRejection && !probeFailed,
        error: probeFailed ? (errOut || `could not run ping (${err.code})`) : null,
      });
    });
  });
}

module.exports = { ping };
