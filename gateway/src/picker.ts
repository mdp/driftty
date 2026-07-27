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
.heading{display:flex;align-items:flex-start;justify-content:space-between;gap:20px}.new{border:1px solid #ff59d6;background:#281126;color:#ffb3ec;font:inherit;font-size:1.7rem;line-height:1;width:48px;height:44px;cursor:pointer}.new:hover,.new:focus{background:#491c43;outline:1px solid #ff59d6}
nav,.sessions{display:grid;gap:12px}.host,.session{display:grid;grid-template-columns:3rem 1fr auto;align-items:center;min-height:72px;padding:14px 18px;border:1px solid #1d6170;background:#081116dd;color:inherit;text-decoration:none;clip-path:polygon(0 0,calc(100% - 10px) 0,100% 10px,100% 100%,10px 100%,0 calc(100% - 10px));transition:.15s}
.host:hover,.host:focus,.session:hover,.session:focus{border-color:#73f7ff;background:#102129;transform:translateX(3px);outline:0}.number{color:#537078;font-size:.75rem}.label{font-size:1.05rem}.arrow{color:#ff59d6;font-size:2rem}.meta{display:block;color:#6d8a91;font-size:.67rem;margin-top:5px}.section{margin:26px 0 10px;color:#6d8a91;font-size:.65rem;letter-spacing:.16em;text-transform:uppercase}.notice{border-left:2px solid #ff59d6;background:#291324;padding:10px 14px;margin:0 0 20px;color:#ffc4ef;font-size:.75rem}
.empty{border:1px dashed #234851;color:#6d8a91;padding:22px;text-align:center;font-size:.78rem}footer{margin-top:28px;color:#537078;font-size:.65rem;letter-spacing:.14em}
</style></head><body><main>${body}<footer>TTYD_MOBILE // SECURE LINK</footer></main></body></html>`, {
    headers: {'content-type': 'text/html; charset=utf-8'},
  });
}

export function pickerResponse(profiles: Profile[]): Response {
  if (profiles.length === 1) {
    return new Response(null, {
      status: 308,
      headers: {location: `/${profiles[0].slug}/`},
    });
  }

  const cards = profiles.map(({slug, label}, index) => `
    <a class="host" href="/${slug}/">
      <span class="number">${String(index + 1).padStart(2, '0')}</span>
      <span class="label">${escapeHtml(label)}</span>
      <span class="arrow">›</span>
    </a>`).join('');

  return page('Select terminal',
    `<div class="eyebrow">gateway online</div><h1>Select<br>terminal</h1><nav>${cards}</nav>`);
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

export function sessionsResponse(
  profile: Profile,
  sessions: TmuxSession[],
  ended?: string,
): Response {
  const fixed = sessions.filter((session) => !session.managed);
  const managed = sessions.filter((session) => session.managed);
  const create = profile.newSessions
    ? `<form method="post" action="/${profile.slug}/sessions"><button class="new" type="submit" title="Create a new session" aria-label="Create a new session">+</button></form>`
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
