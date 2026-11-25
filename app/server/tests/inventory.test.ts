import { describe, it, expect } from 'vitest';
import { imageName, mapReport, osvEcosystem, parseReport, upstreamVersion } from '../services/inventory/report';
import { windowsTech } from '../services/inventory/catalog';

const head = ['host\th1', `machine\t${'b'.repeat(64)}`];

describe('inventory report mapping', () => {
  it('derives OSV ecosystems from os-release', () => {
    const os = (id: string, like: string, v: string) => ({ id, idLike: like, versionId: v, pretty: '' });
    expect(osvEcosystem(os('debian', '', '13'))).toBe('Debian:13');
    expect(osvEcosystem(os('ubuntu', 'debian', '24.04'))).toBe('Ubuntu:24.04:LTS');
    expect(osvEcosystem(os('ubuntu', 'debian', '24.10'))).toBe('Ubuntu:24.10');
    expect(osvEcosystem(os('pop', 'ubuntu debian', '24.04'))).toBe('Ubuntu:24.04:LTS');
    expect(osvEcosystem(os('alpine', '', '3.20.3'))).toBe('Alpine:v3.20');
    expect(osvEcosystem(os('rocky', 'rhel centos fedora', '9.4'))).toBeNull();
  });

  it('extracts upstream versions and image names', () => {
    expect(upstreamVersion('1:9.6p1-3ubuntu13')).toBe('9.6p1');
    expect(upstreamVersion('3.0.11-1~deb12u2')).toBe('3.0.11');
    expect(upstreamVersion('8.3.6-r0')).toBe('8.3.6');
    expect(imageName('ghcr.io/linuxserver/plex:1.43')).toBe('linuxserver/plex');
    expect(imageName('nginx:1.27-alpine')).toBe('nginx');
    expect(imageName('localhost:5000/team/app:1')).toBe('team/app');
    expect(imageName('traefik@sha256:abc')).toBe('traefik');
  });

  it('maps Windows programs and the OS build', () => {
    expect(windowsTech('Microsoft Windows 11 Pro')).toBe('Windows 11');
    expect(windowsTech('Microsoft Windows Server 2022 Datacenter')).toBe('Windows Server 2022');
    const m = mapReport(parseReport([
      ...head,
      'winos\tMicrosoft Windows 11 Pro\t10.0.26200.7171',
      'app\tGoogle Chrome\t142.0.7444.60\tGoogle LLC',
      'app\tMozilla Firefox (x64 es-ES)\t145.0\tMozilla',
      'app\tSome Random Tool\t1.0\tAcme',
      'kernel\tignored-on-windows',
    ].join('\n')));
    const by = Object.fromEntries(m.map((x) => [x.entry.tech, x.version]));
    expect(by).toEqual({ 'Windows 11': '10.0.26200.7171', 'Google Chrome': '142.0.7444.60', 'Mozilla Firefox': '145.0' });
  });

  it('keeps the newest of several packages for one technology, and marks non-OSV distros', () => {
    const m = mapReport(parseReport([
      ...head,
      'os\trocky\trhel centos fedora\t9.4\tRocky Linux 9.4',
      'pkg\trpm\tpython3.11\t3.11.7-1.el9\tpython3.11\t3.11.7-1.el9',
      'pkg\trpm\tpython3.12\t3.12.1-4.el9\tpython3.12\t3.12.1-4.el9',
      'pkg\trpm\topenssh-server\t8.7p1-38.el9\topenssh\t8.7p1-38.el9',
    ].join('\n')));
    const py = m.find((x) => x.entry.tech === 'Python')!;
    expect(py.version).toBe('3.12.1');
    expect(py.package).toBe('rpm|python3.12|3.12.1-4.el9');
    expect(m.find((x) => x.entry.tech === 'OpenSSH')!.package?.startsWith('rpm|')).toBe(true);
  });

  it('rejects reports without host or machine id and ignores junk lines', () => {
    expect(() => parseReport('host\tx\n')).toThrow(/machine id/);
    expect(() => parseReport(`machine\t${'c'.repeat(64)}\n`)).toThrow(/host name/);
    const r = parseReport([...head, 'pkg\tbogus\tx\t1', 'whatever\tline', 'ip\t10.0.0.1'].join('\n'));
    expect(r.packages).toHaveLength(0);
    expect(r.ips).toEqual(['10.0.0.1']);
  });
});
