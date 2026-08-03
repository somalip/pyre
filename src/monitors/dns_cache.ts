import dns from 'node:dns';

const cache = new Map<string, string>();
const pending = new Set<string>();

export function resolveIp(ip: string): string {
  // Extract IP if it has port (e.g., 17.242.13.5:5223 or [2606:4700...]:443)
  let cleanIp = ip;
  if (cleanIp.includes(']:')) {
    cleanIp = cleanIp.substring(1, cleanIp.indexOf(']'));
  } else if (cleanIp.includes(':') && cleanIp.split(':').length === 2) {
    cleanIp = cleanIp.split(':')[0];
  } else if (cleanIp.includes(':') && !cleanIp.includes(']')) {
      // ipv6 without port or brackets? 
      // If there's more than one colon, it's ipv6.
      const lastColon = cleanIp.lastIndexOf(':');
      const isPort = !cleanIp.includes(':', cleanIp.indexOf(':') + 1); // Only 1 colon means it's a port. Wait, ipv6 has many colons.
      // E.g., 2606:4700:103::2.443 -> nettop uses `.` for port in ipv6!
  }

  // Handle nettop's IPv6 port format: 2606:4700:103::2.443 (the last dot separates the port)
  if (cleanIp.includes(':') && cleanIp.includes('.')) {
      const lastDot = cleanIp.lastIndexOf('.');
      if (lastDot > cleanIp.lastIndexOf(':')) {
          cleanIp = cleanIp.substring(0, lastDot);
      }
  }

  if (cache.has(cleanIp)) return cache.get(cleanIp)!;
  if (pending.has(cleanIp)) return ip;
  
  // Don't resolve local/multicast/broadcast
  if (cleanIp.startsWith('127.') || cleanIp.startsWith('192.168.') || cleanIp.startsWith('10.') || cleanIp.startsWith('172.16.') || cleanIp.startsWith('ff02:') || cleanIp === '*:*' || cleanIp === '*' || cleanIp.startsWith('fe80:')) {
    return ip;
  }

  pending.add(cleanIp);
  dns.reverse(cleanIp, (err, hostnames) => {
    if (!err && hostnames && hostnames.length > 0) {
      cache.set(cleanIp, hostnames[0]);
    } else {
      cache.set(cleanIp, cleanIp); // don't try again
    }
    pending.delete(cleanIp);
  });
  
  return ip;
}
