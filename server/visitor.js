import geoip from 'geoip-lite';

// Behind Caddy the real client is the last X-Forwarded-For entry; locally it's the socket address.
export function clientIp(req, trustProxy) {
  const forwarded = trustProxy && req.headers['x-forwarded-for'];
  const ip = forwarded ? forwarded.split(',').at(-1).trim() : req.socket.remoteAddress;
  return ip?.replace(/^::ffff:/, '') ?? null;
}

function geoFor(ip) {
  const hit = ip && geoip.lookup(ip);
  return hit ? { country: hit.country, region: hit.region, city: hit.city } : null;
}

// Checks run in order because Edge/Chrome UAs also contain "Chrome"/"Safari", and iOS UAs contain "Mac OS X".
function deviceFrom(ua = '') {
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'unknown OS';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari' : 'unknown browser';
  return `${browser} on ${os}`;
}

export function describeVisitor(req, trustProxy) {
  const ip = clientIp(req, trustProxy);
  return { ip, geo: geoFor(ip), device: deviceFrom(req.headers['user-agent']) };
}
