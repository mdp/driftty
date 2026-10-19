import {describe, expect, test} from 'bun:test';
import {pickerResponse, sessionsResponse, unavailableResponse} from './picker';
import type {GatewayProfileView} from './gateway-plan';

const profile = (slug: string, label: string, user = 'mark'): GatewayProfileView => ({
  slug, label, hostLabel: 'Istanbul', hostGroup: 'host-1', user,
  mode: 'direct', canCreateSessions: false,
});

describe('host picker', () => {
  test('brands gateway tabs with the driftty ship favicon', async () => {
    const response = pickerResponse([profile('baz', 'Baz')]);
    const html = await response.text();

    expect(html).toContain('data:image/svg+xml');
    expect(html).toContain('— driftty</title>');
  });

  test('shows the host group for a single profile', async () => {
    const response = pickerResponse([profile('baz', 'Baz')]);
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toContain('<h2>Istanbul</h2>');
    expect(body).toContain('href="/baz/"');
    expect(body).toContain('<h3>mark</h3>');
  });

  test('shows a generic sign out link when authentication is enabled', async () => {
    const response = pickerResponse([profile('baz', 'Baz')], new Map(),
      undefined, true);
    const body = await response.text();

    expect(body).toContain('href="/logout" style="color:#73f7ff">Sign out</a>');
  });

  test('hides auth controls when authentication is disabled', async () => {
    const response = pickerResponse([profile('baz', 'Baz')]);

    expect(await response.text()).not.toContain('/logout');
  });

  test('shows Vercel workspaces in the root picker with direct session links', async () => {
    const response = pickerResponse([], new Map(), undefined, true, [{
      name: 'driftty-demo', project: 'driftty', state: 'ready', branch: 'main',
    }], [{id: 'driftty', label: 'Driftty'}]);
    const body = await response.text();
    expect(body).toContain('<h2 class="section-title">Projects</h2>');
    expect(body).toContain('<h2>Driftty</h2>');
    expect(body).toContain('action="/_projects/driftty/workspaces"');
    expect(body).toContain('>Vercel</span>');
    expect(body).toContain('href="/sessions/driftty-demo/"');
    expect(body).toContain('driftty · main');
    expect(body).toContain('class="state state-ready">running</span>');
    expect(body).toContain('Vercel <strong>1 running</strong> · 0 starting · 0 suspended · 0 failed');
    expect(body).toContain('tmux <strong>0 running</strong> · 0 attached · 0 detached');
    expect(body).toContain('action="/_workspaces/driftty-demo/stop"');
    expect(body).toContain('action="/_workspaces/driftty-demo/delete"');
    expect(body).toContain('Confirm delete');
    expect(body).toContain('href="/logout"');
  });

  test('links non-ready Vercel workspaces to their state page', async () => {
    const response = pickerResponse([], new Map(), undefined, false, [{
      name: 'driftty-booting', project: 'driftty', state: 'provisioning', branch: null,
    }], [{id: 'driftty', label: 'Driftty'}]);
    const body = await response.text();
    expect(body).toContain('href="/sessions/driftty-booting"');
    expect(body).toContain('driftty');
    expect(body).toContain('class="state state-provisioning">provisioning</span>');
    expect(body).toContain('0 running</strong> · 1 starting · 0 suspended · 0 failed');
    expect(body).toContain('action="/_workspaces/driftty-booting/delete"');
    expect(body).not.toContain('action="/_workspaces/driftty-booting/stop"');
  });

  test('offers run for suspended workspaces and retry for failed ones', async () => {
    const response = pickerResponse([], new Map(), undefined, false, [
      {name: 'driftty-sleep', project: 'driftty', state: 'stopped', branch: null},
      {name: 'driftty-broken', project: 'driftty', state: 'failed', branch: null},
    ], [{id: 'driftty', label: 'Driftty'}]);
    const body = await response.text();
    expect(body).toContain('action="/_workspaces/driftty-sleep/resume"');
    expect(body).toContain('>Run</button>');
    expect(body).toContain('action="/_workspaces/driftty-broken/retry"');
  });

  test('distinguishes running, attached, detached, and unavailable tmux sessions', async () => {
    const registry = profile('host', 'Host');
    registry.mode = 'registry';
    const response = pickerResponse([registry], new Map([['host', [
      {slug: 'attached', name: 'attached', label: 'Attached', created: 0, attached: 1, managed: false, available: true},
      {slug: 'detached', name: 'detached', label: 'Detached', created: 0, attached: 0, managed: true, available: true},
      {slug: 'offline', name: 'offline', label: 'Offline', created: 0, attached: 0, managed: false, available: false},
    ]]]));
    const body = await response.text();
    expect(body).toContain('running · attached ×1');
    expect(body).toContain('running · detached');
    expect(body).toContain('not running');
    expect(body).toContain('tmux <strong>2 running</strong> · 1 attached · 1 detached');
  });

  test('shows labels for multiple profiles without connection details', async () => {
    const response = pickerResponse([profile('baz', 'Baz'), profile('qux', 'Qux')]);
    const body = await response.text();
    expect(body).toContain('<h2>Istanbul</h2>');
    expect(body).toContain('Baz');
    expect(body).toContain('Qux');
    expect(body).toContain('href="/baz/"');
    expect(body).not.toContain('secret.example.net');
    expect(body).not.toContain('secret-user');
    expect(body).not.toContain('secret-key');
  });

  test('flattens routed sessions into their host group with a named creation form', async () => {
    const login = profile('istanbul', 'Name profile');
    const shells = profile('istanbul-shells', 'Istanbul shells');
    shells.mode = 'registry';
    shells.canCreateSessions = true;
    const response = pickerResponse(
      [login, shells],
      new Map([['istanbul-shells', [{
        slug: 'clever-turing', name: 'ttyd-clever-turing',
        label: 'clever-turing', created: 1785140000, attached: 0,
        managed: true, available: true,
      }]]]),
      () => 'bold-wu',
    );
    const body = await response.text();

    expect(body).toContain('<h3>mark</h3>');
    expect(body.match(/<h2>Istanbul<\/h2>/g)).toHaveLength(1);
    expect(body).toContain('href="/istanbul/"');
    expect(body).toContain('href="/istanbul-shells/clever-turing/"');
    expect(body).toContain('action="/istanbul-shells/sessions"');
    expect(body).toContain('<h2 class="section-title">Hosts</h2>');
    expect(body).toContain('Create a blank SSH session');
    expect(body).toContain('name="name"');
    expect(body).toContain('value="bold-wu"');
    expect(body).toContain('onfocus="this.select()"');
    expect(body).toContain("toLowerCase().replace(/\\s+/g,'-')");
    expect(body).not.toContain('>Istanbul shells<');
  });

  test('buckets sessions by host then user with a per-user create form', async () => {
    const login = profile('istanbul-login', 'Login');
    const markShells = profile('istanbul-mark', 'Mark shells');
    markShells.mode = 'registry';
    markShells.canCreateSessions = true;
    const adaShells = profile('istanbul-ada', 'Ada shells', 'ada');
    adaShells.mode = 'registry';
    adaShells.canCreateSessions = true;
    const response = pickerResponse(
      [login, markShells, adaShells],
      new Map([
        ['istanbul-mark', [{
          slug: 'clever-turing', name: 'ttyd-clever-turing',
          label: 'clever-turing', created: 1785140000, attached: 0,
          managed: true, available: true,
        }]],
        ['istanbul-ada', [{
          slug: 'admiring-hertz', name: 'ttyd-admiring-hertz',
          label: 'admiring-hertz', created: 1785140000, attached: 0,
          managed: true, available: true,
        }]],
      ]),
      () => 'bold-wu',
    );
    const body = await response.text();

    expect(body.match(/<h2>Istanbul<\/h2>/g)).toHaveLength(1);
    expect(body).toContain('<h3>mark</h3>');
    expect(body).toContain('<h3>ada</h3>');
    expect(body).toContain('action="/istanbul-mark/sessions"');
    expect(body).toContain('action="/istanbul-ada/sessions"');
    expect(body).toContain('href="/istanbul-mark/clever-turing/"');
    expect(body).toContain('href="/istanbul-ada/admiring-hertz/"');
  });

  test('local tmux hosts have no user subheading', async () => {
    const local = profile('local', 'Local tmux');
    local.hostLabel = 'Local tmux';
    local.user = undefined;
    local.mode = 'registry';
    local.canCreateSessions = true;
    local.localTmux = true;
    const response = pickerResponse([local]);
    const body = await response.text();

    expect(body).toContain('<h2>Local tmux</h2>');
    expect(body).not.toContain('<h3>');
  });

  test('shows existing sessions and one-click creation when enabled', async () => {
    const item = profile('aachen', 'Aachen');
    item.mode = 'registry';
    item.canCreateSessions = true;
    const response = sessionsResponse(item, [{
      slug: 'clever-turing', name: 'ttyd-clever-turing',
      label: 'clever-turing', created: 1785140000, attached: 0,
      managed: true, available: true,
    }], undefined, true);
    const body = await response.text();
    expect(body).toContain('action="/aachen/sessions"');
    expect(body).toContain('href="/aachen/clever-turing/"');
    expect(body).toContain('clever-turing');
    expect(body).toContain('host online · user mark');
    expect(body).toContain('href="/logout"');
  });

  test('keeps sign out available when a session page is unavailable', async () => {
    const response = unavailableResponse(
      profile('aachen', 'Aachen'),
      'Could not reach host',
      true,
    );

    expect(await response.text()).toContain('href="/logout"');
  });

  test('labels local cards and sections as tmux sessions', async () => {
    const item = profile('local', 'Local tmux');
    item.user = undefined;
    item.mode = 'registry';
    item.canCreateSessions = true;
    item.localTmux = true;
    const response = sessionsResponse(item, [{
      kind: 'local', slug: 'tmux-ZHJpZnR0eS1yZXZpZXctYXBp',
      name: 'driftty-review-api', label: 'review-api',
      created: 1785140000, attached: 1, managed: true, available: true,
    }]);
    const body = await response.text();

    expect(body).toContain('>TMX<');
    expect(body).toContain('tmux sessions');
    expect(body).not.toContain('>Pinned<');
  });
});
