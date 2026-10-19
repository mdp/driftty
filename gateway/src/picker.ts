import {randomSessionName} from './names.ts';
import type {GatewayProfileView} from './gateway-plan.ts';
import type {RemoteShell} from './remote-shell-registry.ts';
import type {WorkspaceRecord} from './workspaces/store.ts';

const favicon = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cg fill='none' stroke='%2339e7ff' stroke-width='4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M32 9v38'/%3E%3Cpath d='M32 10 22 14l10 4z' fill='%2339e7ff' stroke='none'/%3E%3Cpath d='M22 22h20'/%3E%3Cpath d='M24 22c1 5 7 7 8 0M32 22c1 5 7 7 8 0'/%3E%3Cpath d='M16 31h32'/%3E%3Cpath d='M18 31c2 6 11 8 14 0M32 31c3 8 12 6 14 0'/%3E%3Cpath d='M14 44 32 36l18 8c-2 10-9 15-18 15S16 54 14 44z'/%3E%3Cpath d='M14 44 32 36l18 8'/%3E%3Cpath d='M9 57h7M48 57h7'/%3E%3C/g%3E%3C/svg%3E";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}

function page(title: string, body: string): Response {
  return new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<link rel="icon" type="image/svg+xml" href="${favicon}"><title>${escapeHtml(title)} — driftty</title><style>
:root{color-scheme:dark;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#05080b;color:#d8f3e8}
*{box-sizing:border-box}body{min-height:100svh;margin:0;padding:max(28px,env(safe-area-inset-top)) 18px max(28px,env(safe-area-inset-bottom));background:radial-gradient(circle at 80% 10%,#102a32 0,transparent 42%),repeating-linear-gradient(0deg,#ffffff05 0 1px,transparent 1px 4px),#05080b}
main{width:min(680px,100%);margin:auto}.eyebrow{color:#73f7ff;letter-spacing:.18em;font-size:.72rem;text-transform:uppercase}.eyebrow:before{content:"●";margin-right:8px;color:#73ffb2}h1{font-size:clamp(2rem,9vw,4rem);line-height:.95;margin:18px 0 32px;text-transform:uppercase;letter-spacing:-.06em}
.heading{display:flex;align-items:flex-start;justify-content:space-between;gap:20px}.host-group{margin-top:30px}.host-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:12px}.host-heading h2{margin:0;color:#d8f3e8;font-size:1.35rem;letter-spacing:-.03em}.new{display:grid;place-items:center;border:1px solid #ff59d6;background:#281126;color:#ffb3ec;font:inherit;font-size:1.7rem;line-height:1;width:48px;height:44px;cursor:pointer;list-style:none}.new::-webkit-details-marker{display:none}.new:hover,.new:focus{background:#491c43;outline:1px solid #ff59d6}
.create{position:relative}.create[open] .new{background:#491c43}.create form{position:absolute;z-index:2;top:52px;right:0;display:grid;grid-template-columns:minmax(11rem,1fr) auto;gap:8px;width:min(25rem,calc(100vw - 36px));padding:12px;border:1px solid #ff59d6;background:#160d17;box-shadow:0 12px 32px #000b}.create label{grid-column:1/-1;color:#ffb3ec;font-size:.67rem;letter-spacing:.12em;text-transform:uppercase}.create input{min-width:0;padding:11px 12px;border:1px solid #1d6170;background:#05080b;color:#d8f3e8;font:inherit}.create form button{padding:0 14px;border:1px solid #73f7ff;background:#102129;color:#73f7ff;font:inherit;cursor:pointer}
nav,.sessions{display:grid;gap:12px}.host-body{margin-top:12px}.user-group{margin-top:20px}.user-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:10px}.user-heading h3{margin:0;color:#73f7ff;font-size:.9rem;letter-spacing:.06em;text-transform:uppercase}.user-heading h3:before{content:"→ ";color:#537078}.host,.session{display:grid;grid-template-columns:3rem 1fr auto;align-items:center;min-height:72px;padding:14px 18px;border:1px solid #1d6170;background:#081116dd;color:inherit;text-decoration:none;clip-path:polygon(0 0,calc(100% - 10px) 0,100% 10px,100% 100%,10px 100%,0 calc(100% - 10px));transition:.15s}
.host:hover,.host:focus,.session:hover,.session:focus{border-color:#73f7ff;background:#102129;transform:translateX(3px);outline:0}.number{color:#537078;font-size:.75rem}.label{font-size:1.05rem}.arrow{color:#ff59d6;font-size:2rem}.meta{display:block;color:#6d8a91;font-size:.67rem;margin-top:5px}.section{margin:26px 0 10px;color:#6d8a91;font-size:.65rem;letter-spacing:.16em;text-transform:uppercase}.notice{border-left:2px solid #ff59d6;background:#291324;padding:10px 14px;margin:0 0 20px;color:#ffc4ef;font-size:.75rem}
.status-strip{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 28px}.status-item{border:1px solid #1d6170;background:#081116dd;padding:9px 12px;color:#91aeb2;font-size:.68rem}.status-item strong{color:#d8f3e8;font-weight:600}.state{display:inline-block;border:1px solid #42636a;padding:4px 7px;color:#b8c7c7;font-size:.62rem;text-transform:uppercase;letter-spacing:.08em}.state-ready{border-color:#276a51;color:#73ffb2}.state-stopped{border-color:#80692e;color:#f2d786}.state-provisioning{border-color:#286176;color:#73f7ff}.state-failed{border-color:#85435c;color:#ff9bb4}
.workspace-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:stretch;gap:8px}.workspace-row .session{min-width:0}.workspace-actions{display:flex;align-items:center;gap:8px}.workspace-actions form{margin:0}.workspace-action{min-height:42px;padding:8px 11px;border:1px solid #42636a;background:#081116;color:#d8f3e8;font:inherit;font-size:.7rem;cursor:pointer}.workspace-action:hover,.workspace-action:focus{border-color:#73f7ff;outline:0}.workspace-action.danger{border-color:#85435c;color:#ff9bb4}.workspace-action.danger[data-armed="true"]{border-color:#ff7893;background:#391321;color:#fff}.confirm-hint{max-width:100px;color:#ffb3c2;font-size:.6rem}
.section-title{margin:30px 0 10px;color:#73f7ff;font-size:.75rem;letter-spacing:.18em;text-transform:uppercase}.project-group{margin-top:12px}.empty{border:1px dashed #234851;color:#6d8a91;padding:22px;text-align:center;font-size:.78rem}footer{margin-top:28px;color:#537078;font-size:.65rem;letter-spacing:.14em}
@media(max-width:520px){.workspace-row{grid-template-columns:minmax(0,1fr) auto}.workspace-row>.session{grid-column:1/-1}.workspace-actions{justify-content:flex-end}.confirm-hint{max-width:90px}}
</style></head><body><main>${body}<footer>DRIFTTY // SECURE LINK</footer></main></body></html>`, {
    headers: {'content-type': 'text/html; charset=utf-8'},
  });
}

function createSessionControl(
  profile: GatewayProfileView,
  suggestedName: string,
): string {
  return `<details class="create">
    <summary class="new" title="Create a blank SSH session" aria-label="Create a blank SSH session">+</summary>
    <form method="post" action="/${profile.slug}/sessions">
      <label for="new-shell-${profile.slug}">Shell name</label>
      <input id="new-shell-${profile.slug}" name="name" value="${escapeHtml(suggestedName)}"
        pattern="[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*" maxlength="64" required autocomplete="off"
        autocapitalize="none" onfocus="this.select()"
        oninput="this.value=this.value.toLowerCase().replace(/\\s+/g,'-')">
      <button type="submit">Create</button>
    </form>
  </details>`;
}

function authLink(authEnabled: boolean): string {
  return authEnabled
    ? '<a href="/logout" style="color:#73f7ff">Sign out</a>'
    : '';
}

function profileCard(profile: GatewayProfileView, index: number): string {
  return `<a class="host" href="/${profile.slug}/">
    <span class="number">${String(index + 1).padStart(2, '0')}</span>
    <span class="label">${escapeHtml(profile.label)}</span>
    <span class="arrow">›</span>
  </a>`;
}

function sessionCard(
  profile: GatewayProfileView,
  session: RemoteShell,
): string {
  const date = session.created
    ? new Date(session.created * 1000).toLocaleString('en-CA', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).replace(',', '')
    : 'existing tmux session';
  const status = !session.available
    ? 'not running'
    : session.attached > 0
    ? `running · attached ×${session.attached}`
    : 'running · detached';
  return `<a class="session" href="/${profile.slug}/${session.slug}/">
    <span class="number">${session.kind === 'local' ? 'TMX' : session.managed ? 'NEW' : 'PIN'}</span>
    <span><span class="label">${escapeHtml(session.label)}</span>
      <span class="meta">${escapeHtml(date)} · ${status}</span></span>
    <span class="arrow">›</span>
  </a>`;
}

function hostOnlineEyebrow(profile: GatewayProfileView): string {
  return profile.user
    ? `host online · user ${escapeHtml(profile.user)}`
    : 'host online';
}

function workspaceCard(workspace: Pick<WorkspaceRecord, 'name' | 'project' | 'state' | 'branch' | 'operation' | 'statusError'>): string {
  const name = encodeURIComponent(workspace.name);
  const href = workspace.state === 'ready' ? `/sessions/${name}/` : `/sessions/${name}`;
  const detail = [workspace.project, workspace.branch]
    .filter((part): part is string => Boolean(part)).map(escapeHtml).join(' · ');
  const stateLabel = workspace.state === 'ready' ? 'running'
    : workspace.state === 'stopped' ? 'suspended'
    : workspace.state;
  const action = workspace.state === 'ready'
    ? {action: 'stop', label: 'Suspend'}
    : workspace.state === 'stopped'
    ? {action: 'resume', label: 'Run'}
    : workspace.state === 'failed'
    ? {action: 'retry', label: 'Retry'}
    : undefined;
  const busy = Boolean(workspace.operation);
  const operation = busy ? undefined : action;
  const progress = busy ? ` · ${escapeHtml(workspace.operation!)}` : '';
  const warning = workspace.statusError ? `<span class="meta">Status refresh failed: ${escapeHtml(workspace.statusError)}</span>` : '';
  return `<div class="workspace-row">
    <a class="session" href="${href}">
    <span class="number">Vercel</span>
    <span><span class="label">${escapeHtml(workspace.name)}</span>
      <span class="meta">${detail}${progress}</span>${warning}</span>
    <span class="state state-${workspace.state}">${stateLabel}</span>
    </a>
    <div class="workspace-actions">${operation ? `<form method="post" action="/_workspaces/${name}/${operation.action}"><button class="workspace-action" type="submit">${operation.label}</button></form>` : ''}
      <form method="post" action="/_workspaces/${name}/delete" data-confirm-delete>
        <input type="hidden" name="confirm" value="">
        <button class="workspace-action danger" type="submit" data-armed="false" ${busy ? 'disabled' : ''}>Delete</button>
        <span class="confirm-hint" hidden>Tap again to permanently delete</span>
      </form>
    </div>
  </div>`;
}

function statusStrip(
  sessionsByProfile: ReadonlyMap<string, RemoteShell[]>,
  workspaces: Array<Pick<WorkspaceRecord, 'name' | 'project' | 'state' | 'branch'>>,
): string {
  const shells = [...sessionsByProfile.values()].flat();
  const runningShells = shells.filter(({available}) => available).length;
  const attachedShells = shells.filter(({available, attached}) => available && attached > 0).length;
  const detachedShells = runningShells - attachedShells;
  const count = (state: WorkspaceRecord['state']) => workspaces.filter((workspace) => workspace.state === state).length;
  return `<div class="status-strip" aria-label="Gateway status">
    <span class="status-item">Gateway <strong>online</strong></span>
    <span class="status-item">tmux <strong>${runningShells} running</strong> · ${attachedShells} attached · ${detachedShells} detached</span>
    <span class="status-item">Vercel <strong>${count('ready')} running</strong> · ${count('provisioning')} starting · ${count('stopped')} suspended · ${count('failed')} failed</span>
  </div>`;
}

export function pickerResponse(
  profiles: GatewayProfileView[],
  sessionsByProfile: ReadonlyMap<string, RemoteShell[]> = new Map(),
  generateName: () => string = randomSessionName,
  authEnabled = false,
  workspaces: Array<Pick<WorkspaceRecord, 'name' | 'project' | 'state' | 'branch' | 'operation' | 'statusError'>> = [],
  projects: Array<{id: string; label: string}> = [],
): Response {
  const groups = new Map<string, GatewayProfileView[]>();
  for (const profile of profiles) {
    groups.set(
      profile.hostGroup,
      [...(groups.get(profile.hostGroup) ?? []), profile],
    );
  }

  const hostGroups = [...groups.values()].map((hostProfiles) => {
    const byUser = new Map<string, GatewayProfileView[]>();
    const userOrder: string[] = [];
    for (const profile of hostProfiles) {
      const user = profile.user ?? '';
      if (!byUser.has(user)) userOrder.push(user);
      byUser.set(user, [...(byUser.get(user) ?? []), profile]);
    }
    const hasNamedUsers = userOrder.some((user) => user !== '');

    let index = 0;
    const sections: string[] = [];
    for (const user of userOrder) {
      const userProfiles = byUser.get(user)!;
      const creator = userProfiles.find((profile) => profile.canCreateSessions);
      const cards: string[] = [];
      for (const profile of userProfiles) {
        if (profile.mode === 'direct') cards.push(profileCard(profile, index++));
        for (const session of sessionsByProfile.get(profile.slug) ?? []) {
          cards.push(sessionCard(profile, session));
          index += 1;
        }
      }
      const nav = `<nav>${cards.length
        ? cards.join('')
        : '<div class="empty">No shells are running.</div>'}</nav>`;
      if (user === '' && !hasNamedUsers) {
        sections.push(`<div class="host-body">${nav}</div>`);
      } else {
        sections.push(`<div class="user-group">
      <div class="user-heading">
        <h3>${escapeHtml(user)}</h3>
        ${creator ? createSessionControl(creator, generateName()) : ''}
      </div>
      ${nav}
    </div>`);
      }
    }

    const soleCreator = !hasNamedUsers
      ? hostProfiles.find((profile) => profile.canCreateSessions)
      : undefined;
    return `<section class="host-group">
      <div class="host-heading">
        <h2>${escapeHtml(hostProfiles[0].hostLabel)}</h2>
        ${soleCreator ? createSessionControl(soleCreator, generateName()) : ''}
      </div>
      ${sections.join('')}
    </section>`;
  }).join('');
  const projectSections = projects.map((project) => {
    const projectWorkspaces = workspaces.filter(({project: id}) => id === project.id);
    return `<section class="host-group project-group"><div class="host-heading"><h2>${escapeHtml(project.label)}</h2>
      <details class="create"><summary class="new" title="Create workspace" aria-label="Create workspace">+</summary>
      <form method="post" action="/_projects/${encodeURIComponent(project.id)}/workspaces">
      <label for="new-workspace-${escapeHtml(project.id)}">Workspace name</label>
      <input id="new-workspace-${escapeHtml(project.id)}" name="name" value="${escapeHtml(generateName())}" pattern="[a-z0-9][a-z0-9-]{2,62}" maxlength="63" required autocomplete="off" autocapitalize="none" onfocus="this.select()">
      <button type="submit">Create</button></form></details></div>
      <nav class="sessions">${projectWorkspaces.length ? projectWorkspaces.map(workspaceCard).join('') : '<div class="empty">No workspaces yet.</div>'}</nav></section>`;
  }).join('');

  return page('Select terminal',
    `<div class="eyebrow">gateway online</div><div style="text-align:right">${authLink(authEnabled)}</div><h1>Gateway<br>status</h1>${statusStrip(sessionsByProfile, workspaces)}<h2 class="section-title">Projects</h2>${projectSections}<h2 class="section-title">Hosts</h2>${hostGroups}<script>
setTimeout(()=>{if(!document.querySelector('form[data-confirm-delete][data-confirmed="true"]'))location.reload()},15000);
document.addEventListener('submit',event=>{const form=event.target.closest('form[data-confirm-delete]');if(!form)return;if(form.dataset.confirmed==='true')return;event.preventDefault();form.dataset.confirmed='true';form.querySelector('input[name="confirm"]').value='delete';const button=form.querySelector('button');button.textContent='Confirm delete';button.dataset.armed='true';form.querySelector('.confirm-hint').hidden=false});
</script>`);
}

export function sessionsResponse(
  profile: GatewayProfileView,
  sessions: RemoteShell[],
  ended?: string,
  authEnabled = false,
): Response {
  const local = profile.localTmux === true;
  const fixed = sessions.filter((session) => !session.managed);
  const managed = sessions.filter((session) => session.managed);
  const create = profile.canCreateSessions
    ? createSessionControl(profile, randomSessionName())
    : '';
  const notice = ended
    ? `<div class="notice">Session “${escapeHtml(ended)}” is no longer running.</div>`
    : '';
  const fixedCards = fixed.length
    ? fixed.map((session) => sessionCard(profile, session)).join('')
    : '<div class="empty">No pinned sessions are running.</div>';
  const managedSection = profile.canCreateSessions && !local
    ? `<div class="section">New sessions</div><div class="sessions">${
      managed.length
        ? managed.map((session) => sessionCard(profile, session)).join('')
        : '<div class="empty">Create a session with the + button.</div>'
    }</div>`
    : '';
  const localSection = local
    ? `<div class="section">tmux sessions</div><div class="sessions">${
      sessions.length
        ? sessions.map((session) => sessionCard(profile, session)).join('')
        : '<div class="empty">No tmux sessions are running.</div>'
    }</div>`
    : '';

  return page(profile.label, `<div class="eyebrow">${hostOnlineEyebrow(profile)}</div>
    <div style="text-align:right">${authLink(authEnabled)}</div>
    <div class="heading"><h1>${escapeHtml(profile.label)}</h1>${create}</div>
    ${notice}${localSection}${local ? '' : `<div class="section">Pinned</div><div class="sessions">${fixedCards}</div>`}
    ${managedSection}`);
}

export function unavailableResponse(
  profile: GatewayProfileView,
  detail: string,
  authEnabled = false,
): Response {
  return page(`${profile.label} unavailable`, `<div class="eyebrow">${hostOnlineEyebrow(profile)}</div>
    <div style="text-align:right">${authLink(authEnabled)}</div>
    <h1>${escapeHtml(profile.label)}</h1>
    <div class="notice">${escapeHtml(detail)}</div>
    <a class="host" href="/"><span class="number">←</span><span class="label">Back to hosts</span><span class="arrow">›</span></a>`);
}
