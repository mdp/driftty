import {randomSessionName} from './names';
import type {Profile} from './profiles';
import type {TmuxSession} from './sessions';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}

function page(title: string, body: string): Response {
  return new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${escapeHtml(title)}</title><style>
:root{color-scheme:dark;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#05080b;color:#d8f3e8}
*{box-sizing:border-box}body{min-height:100svh;margin:0;padding:max(28px,env(safe-area-inset-top)) 18px max(28px,env(safe-area-inset-bottom));background:radial-gradient(circle at 80% 10%,#102a32 0,transparent 42%),repeating-linear-gradient(0deg,#ffffff05 0 1px,transparent 1px 4px),#05080b}
main{width:min(680px,100%);margin:auto}.eyebrow{color:#73f7ff;letter-spacing:.18em;font-size:.72rem;text-transform:uppercase}.eyebrow:before{content:"●";margin-right:8px;color:#73ffb2}h1{font-size:clamp(2rem,9vw,4rem);line-height:.95;margin:18px 0 32px;text-transform:uppercase;letter-spacing:-.06em}
.heading{display:flex;align-items:flex-start;justify-content:space-between;gap:20px}.host-group{margin-top:30px}.host-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:12px}.host-heading h2{margin:0;color:#d8f3e8;font-size:1.35rem;letter-spacing:-.03em}.new{display:grid;place-items:center;border:1px solid #ff59d6;background:#281126;color:#ffb3ec;font:inherit;font-size:1.7rem;line-height:1;width:48px;height:44px;cursor:pointer;list-style:none}.new::-webkit-details-marker{display:none}.new:hover,.new:focus{background:#491c43;outline:1px solid #ff59d6}
.create{position:relative}.create[open] .new{background:#491c43}.create form{position:absolute;z-index:2;top:52px;right:0;display:grid;grid-template-columns:minmax(11rem,1fr) auto;gap:8px;width:min(25rem,calc(100vw - 36px));padding:12px;border:1px solid #ff59d6;background:#160d17;box-shadow:0 12px 32px #000b}.create label{grid-column:1/-1;color:#ffb3ec;font-size:.67rem;letter-spacing:.12em;text-transform:uppercase}.create input{min-width:0;padding:11px 12px;border:1px solid #1d6170;background:#05080b;color:#d8f3e8;font:inherit}.create form button{padding:0 14px;border:1px solid #73f7ff;background:#102129;color:#73f7ff;font:inherit;cursor:pointer}
nav,.sessions{display:grid;gap:12px}.host,.session{display:grid;grid-template-columns:3rem 1fr auto;align-items:center;min-height:72px;padding:14px 18px;border:1px solid #1d6170;background:#081116dd;color:inherit;text-decoration:none;clip-path:polygon(0 0,calc(100% - 10px) 0,100% 10px,100% 100%,10px 100%,0 calc(100% - 10px));transition:.15s}
.host:hover,.host:focus,.session:hover,.session:focus{border-color:#73f7ff;background:#102129;transform:translateX(3px);outline:0}.number{color:#537078;font-size:.75rem}.label{font-size:1.05rem}.arrow{color:#ff59d6;font-size:2rem}.meta{display:block;color:#6d8a91;font-size:.67rem;margin-top:5px}.section{margin:26px 0 10px;color:#6d8a91;font-size:.65rem;letter-spacing:.16em;text-transform:uppercase}.notice{border-left:2px solid #ff59d6;background:#291324;padding:10px 14px;margin:0 0 20px;color:#ffc4ef;font-size:.75rem}
.empty{border:1px dashed #234851;color:#6d8a91;padding:22px;text-align:center;font-size:.78rem}footer{margin-top:28px;color:#537078;font-size:.65rem;letter-spacing:.14em}
</style></head><body><main>${body}<footer>TTYD_MOBILE // SECURE LINK</footer></main></body></html>`, {
    headers: {'content-type': 'text/html; charset=utf-8'},
  });
}

function createSessionControl(profile: Profile, suggestedName: string): string {
  return `<details class="create">
    <summary class="new" title="Create a new shell" aria-label="Create a new shell">+</summary>
    <form method="post" action="/${profile.slug}/sessions">
      <label for="new-shell-${profile.slug}">Shell name</label>
      <input id="new-shell-${profile.slug}" name="name" value="${escapeHtml(suggestedName)}"
        pattern="[a-z0-9]+(?:-[a-z0-9]+)*" maxlength="64" required autocomplete="off">
      <button type="submit">Create</button>
    </form>
  </details>`;
}

function profileCard(profile: Profile, index: number): string {
  return `<a class="host" href="/${profile.slug}/">
    <span class="number">${String(index + 1).padStart(2, '0')}</span>
    <span class="label">${escapeHtml(profile.label)}</span>
    <span class="arrow">›</span>
  </a>`;
}

function sessionCard(profile: Profile, session: TmuxSession): string {
  const date = session.created
    ? new Date(session.created * 1000).toLocaleString('en-CA', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).replace(',', '')
    : 'existing tmux session';
  const status = session.attached > 0
    ? `attached ×${session.attached}`
    : 'detached';
  return `<a class="session" href="/${profile.slug}/${session.slug}/">
    <span class="number">${session.managed ? 'NEW' : 'PIN'}</span>
    <span><span class="label">${escapeHtml(session.label)}</span>
      <span class="meta">${escapeHtml(date)} · ${status}</span></span>
    <span class="arrow">›</span>
  </a>`;
}

export function pickerResponse(
  profiles: Profile[],
  sessionsByProfile: ReadonlyMap<string, TmuxSession[]> = new Map(),
  generateName: () => string = randomSessionName,
): Response {
  const groups = new Map<string, Profile[]>();
  for (const profile of profiles) {
    groups.set(profile.host, [...(groups.get(profile.host) ?? []), profile]);
  }

  const hostGroups = [...groups.values()].map((hostProfiles) => {
    const creator = hostProfiles.find((profile) => profile.newSessions);
    const cards: string[] = [];
    let index = 0;
    for (const profile of hostProfiles) {
      if (!profile.sessionRouting) cards.push(profileCard(profile, index++));
      for (const session of sessionsByProfile.get(profile.slug) ?? []) {
        cards.push(sessionCard(profile, session));
        index += 1;
      }
    }
    return `<section class="host-group">
      <div class="host-heading">
        <h2>${escapeHtml(hostProfiles[0].hostLabel)}</h2>
        ${creator ? createSessionControl(creator, generateName()) : ''}
      </div>
      <nav>${cards.length ? cards.join('') : '<div class="empty">No shells are running.</div>'}</nav>
    </section>`;
  }).join('');

  return page('Select terminal',
    `<div class="eyebrow">gateway online</div><h1>Select<br>terminal</h1>${hostGroups}`);
}

export function sessionsResponse(
  profile: Profile,
  sessions: TmuxSession[],
  ended?: string,
): Response {
  const fixed = sessions.filter((session) => !session.managed);
  const managed = sessions.filter((session) => session.managed);
  const create = profile.newSessions
    ? createSessionControl(profile, randomSessionName())
    : '';
  const notice = ended
    ? `<div class="notice">Session “${escapeHtml(ended)}” is no longer running.</div>`
    : '';
  const fixedCards = fixed.length
    ? fixed.map((session) => sessionCard(profile, session)).join('')
    : '<div class="empty">No pinned sessions are running.</div>';
  const managedSection = profile.newSessions
    ? `<div class="section">New sessions</div><div class="sessions">${
      managed.length
        ? managed.map((session) => sessionCard(profile, session)).join('')
        : '<div class="empty">Create a session with the + button.</div>'
    }</div>`
    : '';

  return page(profile.label, `<div class="eyebrow">host online</div>
    <div class="heading"><h1>${escapeHtml(profile.label)}</h1>${create}</div>
    ${notice}<div class="section">Pinned</div><div class="sessions">${fixedCards}</div>
    ${managedSection}`);
}

export function unavailableResponse(profile: Profile, detail: string): Response {
  return page(`${profile.label} unavailable`, `<div class="eyebrow">host unavailable</div>
    <h1>${escapeHtml(profile.label)}</h1>
    <div class="notice">${escapeHtml(detail)}</div>
    <a class="host" href="/"><span class="number">←</span><span class="label">Back to hosts</span><span class="arrow">›</span></a>`);
}
