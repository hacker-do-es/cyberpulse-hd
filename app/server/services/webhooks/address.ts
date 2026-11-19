import ipaddr from 'ipaddr.js';

/* Is this an address on the public internet?

   ipaddr.js classifies every special-purpose block from the IANA IPv4/IPv6
   registries (private, loopback, link-local and cloud metadata, CGNAT,
   multicast, documentation, benchmarking, ...). Only plain global unicast
   counts as public. IPv4-mapped IPv6 (::ffff:10.0.0.1) is unwrapped first,
   and translation prefixes that embed an IPv4 address (NAT64 64:ff9b::/96,
   6to4 2002::/16, Teredo) are refused because they can lead back into a
   private network. */
export function isPublicAddress(ip: string): boolean {
  if (!ipaddr.isValid(ip)) return false;
  try {
    return ipaddr.process(ip).range() === 'unicast';
  } catch {
    return false;
  }
}

/* True for a literal IP (v4 or v6), false for a hostname. */
export function isIpLiteral(host: string): boolean {
  const bare = host.replace(/^\[(.*)\]$/, '$1');
  return ipaddr.IPv4.isValidFourPartDecimal(bare) || ipaddr.IPv6.isValid(bare);
}

export function stripBrackets(host: string): string {
  return host.replace(/^\[(.*)\]$/, '$1');
}
