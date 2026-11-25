/* Which installed packages are worth tracking as technologies.

   A host has thousands of packages; turning all of them into stack rows
   would bury the stack and match noise. Only security-relevant software
   is mapped (servers, runtimes, crypto, remote access, browsers...), plus
   the operating system itself. Unknown packages are ignored. */

export interface CatalogEntry {
  tech: string;
  vendor: string;
  category: string;
  /* Linux binary package names (dpkg, rpm, apk). */
  pkg?: RegExp;
  /* Windows "Programs and Features" display names. */
  win?: RegExp;
  /* Container image names, without registry and tag ("nginx",
     "linuxserver/plex"). */
  image?: RegExp;
}

export const CATALOG: CatalogEntry[] = [
  { tech: 'OpenSSH', vendor: 'OpenBSD', category: 'Remote access', pkg: /^openssh(-server)?$/ },
  { tech: 'OpenSSL', vendor: 'OpenSSL Project', category: 'Crypto', pkg: /^(openssl|libssl3t64|libssl3|libssl1\.1|openssl-libs)$/ },
  { tech: 'nginx', vendor: 'F5 / NGINX', category: 'Web Server', pkg: /^nginx(-core|-full|-light|-extras)?$/, image: /^(library\/)?nginx$|^nginxinc\/nginx-unprivileged$/ },
  { tech: 'Apache HTTP Server', vendor: 'Apache Software Foundation', category: 'Web Server', pkg: /^(apache2|httpd)$/, image: /^(library\/)?httpd$/ },
  { tech: 'PHP', vendor: 'The PHP Group', category: 'Runtime', pkg: /^php(\d\.\d)?-(cli|fpm|common)$|^php$/, image: /^(library\/)?php$/ },
  { tech: 'Python', vendor: 'Python Software Foundation', category: 'Runtime', pkg: /^python3\.\d+$/, win: /^Python 3\.\d+\.\d+ \(64-bit\)$|^Python 3\.\d+\.\d+$/, image: /^(library\/)?python$/ },
  { tech: 'Node.js', vendor: 'OpenJS Foundation', category: 'Runtime', pkg: /^nodejs$/, win: /^Node\.js$/, image: /^(library\/)?node$/ },
  { tech: 'Java', vendor: 'Oracle', category: 'Runtime', pkg: /^openjdk-\d+-jre(-headless)?$|^java-\d+-openjdk(-headless)?$/, win: /^Java( \d+)?( Update \d+)?( \(64-bit\))?$|^Java\(TM\) SE|^Eclipse Temurin JDK|^Microsoft Build of OpenJDK/, image: /^(library\/)?(openjdk|eclipse-temurin)$/ },
  { tech: 'PostgreSQL', vendor: 'PostgreSQL Global Development Group', category: 'Database', pkg: /^postgresql-\d+$|^postgresql\d*-server$/, win: /^PostgreSQL \d+/, image: /^(library\/)?postgres$/ },
  { tech: 'MySQL', vendor: 'Oracle', category: 'Database', pkg: /^mysql-server(-core)?(-\d\.\d)?$|^mysql-community-server$/, win: /^MySQL Server \d/, image: /^(library\/)?mysql$/ },
  { tech: 'MariaDB', vendor: 'MariaDB Foundation', category: 'Database', pkg: /^mariadb-server(-core)?(-\d+\.\d+)?$/, image: /^(library\/)?mariadb$/ },
  { tech: 'Redis', vendor: 'Redis Ltd.', category: 'Database', pkg: /^redis(-server)?$/, image: /^(library\/)?redis$/ },
  { tech: 'MongoDB', vendor: 'MongoDB Inc.', category: 'Database', pkg: /^mongodb-(org-)?server$/, image: /^(library\/)?mongo$/ },
  { tech: 'Elasticsearch', vendor: 'Elastic', category: 'Database', pkg: /^elasticsearch$/, image: /^(library\/)?elasticsearch$|^elastic\/elasticsearch$/ },
  { tech: 'Docker Engine', vendor: 'Docker Inc.', category: 'Containers', pkg: /^(docker-ce|docker\.io|moby-engine|docker-engine|docker)$/ },
  /* Its own product and version line (4.x), not the engine's (29.x). */
  { tech: 'Docker Desktop', vendor: 'Docker Inc.', category: 'Containers', pkg: /^docker-desktop$/, win: /^Docker Desktop$/ },
  { tech: 'containerd', vendor: 'CNCF', category: 'Containers', pkg: /^containerd(\.io)?$/ },
  { tech: 'runc', vendor: 'Open Container Initiative', category: 'Containers', pkg: /^runc$/ },
  { tech: 'sudo', vendor: 'Todd C. Miller', category: 'System', pkg: /^sudo$/ },
  { tech: 'glibc', vendor: 'GNU', category: 'System', pkg: /^(libc6|glibc)$/ },
  { tech: 'systemd', vendor: 'systemd', category: 'System', pkg: /^systemd$/ },
  { tech: 'polkit', vendor: 'freedesktop.org', category: 'System', pkg: /^(polkitd|policykit-1|polkit)$/ },
  { tech: 'Bash', vendor: 'GNU', category: 'System', pkg: /^bash$/ },
  { tech: 'XZ Utils', vendor: 'Tukaani', category: 'System', pkg: /^(xz-utils|xz)$/ },
  { tech: 'curl', vendor: 'curl', category: 'System', pkg: /^curl$/ },
  { tech: 'Git', vendor: 'Git', category: 'Development', pkg: /^git$/, win: /^Git( version [\d.]+)?$/ },
  { tech: 'Samba', vendor: 'Samba Team', category: 'File sharing', pkg: /^samba$/ },
  { tech: 'OpenVPN', vendor: 'OpenVPN Inc.', category: 'VPN', pkg: /^openvpn$/, win: /^OpenVPN( \d|$)|^OpenVPN Connect/ },
  { tech: 'WireGuard', vendor: 'WireGuard', category: 'VPN', win: /^WireGuard$/ },
  { tech: 'BIND', vendor: 'ISC', category: 'DNS', pkg: /^(bind9|bind)$/ },
  { tech: 'Postfix', vendor: 'Postfix', category: 'Email', pkg: /^postfix$/ },
  { tech: 'Exim', vendor: 'Exim', category: 'Email', pkg: /^exim4(-daemon-(heavy|light))?$|^exim$/ },
  { tech: 'Dovecot', vendor: 'Dovecot', category: 'Email', pkg: /^dovecot(-core)?$/ },
  { tech: 'Squid', vendor: 'Squid', category: 'Proxy', pkg: /^squid$/ },
  { tech: 'HAProxy', vendor: 'HAProxy Technologies', category: 'Proxy', pkg: /^haproxy$/, image: /^(library\/)?haproxy$/ },
  { tech: 'Traefik', vendor: 'Traefik Labs', category: 'Proxy', image: /^(library\/)?traefik$/ },
  { tech: 'cloudflared', vendor: 'Cloudflare', category: 'Proxy', pkg: /^cloudflared$/, image: /^cloudflare\/cloudflared$/ },
  { tech: 'Tomcat', vendor: 'Apache Software Foundation', category: 'Web Server', pkg: /^tomcat\d+$/, image: /^(library\/)?tomcat$/ },
  { tech: 'Jenkins', vendor: 'Jenkins', category: 'CI/CD', pkg: /^jenkins$/, image: /^jenkins\/jenkins$/ },
  { tech: 'GitLab', vendor: 'GitLab Inc.', category: 'CI/CD', pkg: /^gitlab-(ce|ee)$/, image: /^gitlab\/gitlab-(ce|ee)$/ },
  { tech: 'Grafana', vendor: 'Grafana Labs', category: 'Monitoring', pkg: /^grafana$/, image: /^grafana\/grafana(-oss|-enterprise)?$/ },
  { tech: 'Home Assistant', vendor: 'Open Home Foundation', category: 'IoT', image: /^homeassistant\/home-assistant$|^home-assistant\/home-assistant$/ },
  { tech: 'Portainer CE', vendor: 'Portainer.io', category: 'Containers', image: /^portainer\/portainer-ce$/ },
  { tech: 'Plex Media Server', vendor: 'Plex Inc.', category: 'Media', image: /^plexinc\/pms-docker$|^linuxserver\/plex$/ },
  { tech: 'Sonarr', vendor: 'Sonarr', category: 'Media', image: /^linuxserver\/sonarr$/ },
  { tech: 'Radarr', vendor: 'Radarr', category: 'Media', image: /^linuxserver\/radarr$/ },
  { tech: 'Prowlarr', vendor: 'Prowlarr', category: 'Media', image: /^linuxserver\/prowlarr$/ },
  { tech: 'Bazarr', vendor: 'Bazarr', category: 'Media', image: /^linuxserver\/bazarr$/ },
  { tech: 'Transmission', vendor: 'Transmission Project', category: 'Media', pkg: /^transmission-daemon$/, image: /^linuxserver\/transmission$/ },
  { tech: 'Watchtower', vendor: 'containrrr', category: 'Containers', image: /^(containrrr|nickfedor)\/watchtower$/ },
  { tech: 'Gluetun', vendor: 'qdm12', category: 'VPN', image: /^qmcgaw\/gluetun$/ },
  { tech: 'n8n', vendor: 'n8n GmbH', category: 'Automation', image: /^n8nio\/n8n$/ },
  { tech: 'Rocket.Chat', vendor: 'Rocket.Chat Technologies', category: 'Collaboration', image: /^(library\/)?rocket\.chat$|^rocketchat\/rocket\.chat$/ },
  { tech: 'Directus', vendor: 'Monospace Inc.', category: 'CMS', image: /^directus\/directus$/ },
  { tech: 'WordPress', vendor: 'WordPress Foundation', category: 'CMS', image: /^(library\/)?wordpress$/ },
  { tech: 'Moodle', vendor: 'Moodle HQ', category: 'LMS', image: /^bitnami\/moodle$/ },
  { tech: 'Redmine', vendor: 'Redmine', category: 'Project management', image: /^(library\/)?redmine$/ },
  { tech: 'BookStack', vendor: 'BookStack', category: 'Wiki', image: /^linuxserver\/bookstack$/ },
  { tech: 'Google Chrome', vendor: 'Google', category: 'Browser', pkg: /^google-chrome-stable$/, win: /^Google Chrome$/ },
  { tech: 'Mozilla Firefox', vendor: 'Mozilla', category: 'Browser', pkg: /^firefox(-esr)?$/, win: /^Mozilla Firefox/ },
  { tech: 'Microsoft Edge', vendor: 'Microsoft', category: 'Browser', win: /^Microsoft Edge$/ },
  { tech: 'Mozilla Thunderbird', vendor: 'Mozilla', category: 'Email', pkg: /^thunderbird$/, win: /^Mozilla Thunderbird/ },
  { tech: '7-Zip', vendor: 'Igor Pavlov', category: 'Utilities', pkg: /^7zip$|^p7zip(-full)?$/, win: /^7-Zip/ },
  { tech: 'WinRAR', vendor: 'win.rar GmbH', category: 'Utilities', win: /^WinRAR/ },
  { tech: 'Notepad++', vendor: 'Notepad++', category: 'Utilities', win: /^Notepad\+\+/ },
  { tech: 'Adobe Acrobat', vendor: 'Adobe', category: 'Office', win: /^Adobe Acrobat/ },
  { tech: 'Microsoft Office', vendor: 'Microsoft', category: 'Office', win: /^Microsoft (Office (Professional|Standard|Home)|365 Apps|Office 365)/ },
  { tech: 'Microsoft Visual Studio Code', vendor: 'Microsoft', category: 'Development', pkg: /^code$/, win: /^Microsoft Visual Studio Code/ },
  { tech: 'PuTTY', vendor: 'Simon Tatham', category: 'Remote access', pkg: /^putty$/, win: /^PuTTY/ },
  { tech: 'WinSCP', vendor: 'Martin Prikryl', category: 'Remote access', win: /^WinSCP/ },
  { tech: 'FileZilla', vendor: 'FileZilla', category: 'Remote access', pkg: /^filezilla$/, win: /^FileZilla/ },
  { tech: 'TeamViewer', vendor: 'TeamViewer', category: 'Remote access', pkg: /^teamviewer$/, win: /^TeamViewer/ },
  { tech: 'AnyDesk', vendor: 'AnyDesk', category: 'Remote access', pkg: /^anydesk$/, win: /^AnyDesk/ },
  { tech: 'Zoom', vendor: 'Zoom Communications', category: 'Collaboration', pkg: /^zoom$/, win: /^Zoom( Workplace)?(\s|\(|$)/ },
  { tech: 'Slack', vendor: 'Salesforce', category: 'Collaboration', pkg: /^slack-desktop$/, win: /^Slack/ },
  { tech: 'FortiClient', vendor: 'Fortinet', category: 'VPN', pkg: /^forticlient$/, win: /^FortiClient/ },
  { tech: 'Oracle VirtualBox', vendor: 'Oracle', category: 'Virtualization', pkg: /^virtualbox(-\d+\.\d+)?$/, win: /^Oracle (VM )?VirtualBox/ },
  { tech: 'VMware Workstation', vendor: 'Broadcom', category: 'Virtualization', win: /^VMware Workstation/ },
  { tech: 'Wireshark', vendor: 'Wireshark Foundation', category: 'Network', pkg: /^wireshark(-qt)?$/, win: /^Wireshark/ },
  { tech: 'VLC media player', vendor: 'VideoLAN', category: 'Media', pkg: /^vlc$/, win: /^VLC media player/ },
  { tech: 'KeePass', vendor: 'Dominik Reichl', category: 'Security', pkg: /^keepass2$/, win: /^KeePass Password Safe/ },
];

export type PackageSource = 'dpkg' | 'rpm' | 'apk' | 'win' | 'image';

export function catalogFor(source: PackageSource, name: string): CatalogEntry | undefined {
  const n = source === 'win' ? name.trim() : name.trim().toLowerCase();
  for (const e of CATALOG) {
    const re = source === 'win' ? e.win : source === 'image' ? e.image : e.pkg;
    if (re?.test(n)) return e;
  }
  return undefined;
}

/* "Windows 11 Pro" → "Windows 11"; "Windows Server 2022 Datacenter" →
   "Windows Server 2022"; the version is the full build (10.0.26200.7171),
   which is how Microsoft's CVE records state affected ranges. */
export function windowsTech(productName: string): string | null {
  const m = productName.match(/^(?:Microsoft )?(Windows (?:Server \d{4}(?: R2)?|\d+))/i);
  return m ? m[1].replace(/^windows/i, 'Windows').replace(/server/i, 'Server') : null;
}
