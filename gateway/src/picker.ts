import type {Profile} from './profiles';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
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

  return new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Select terminal</title><style>
:root{color-scheme:dark;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#05080b;color:#d8f3e8}
*{box-sizing:border-box}body{min-height:100svh;margin:0;padding:max(28px,env(safe-area-inset-top)) 18px max(28px,env(safe-area-inset-bottom));background:radial-gradient(circle at 80% 10%,#102a32 0,transparent 42%),repeating-linear-gradient(0deg,#ffffff05 0 1px,transparent 1px 4px),#05080b}
main{width:min(640px,100%);margin:auto}.eyebrow{color:#73f7ff;letter-spacing:.18em;font-size:.72rem;text-transform:uppercase}.eyebrow:before{content:"●";margin-right:8px;color:#73ffb2}h1{font-size:clamp(2rem,9vw,4rem);line-height:.95;margin:18px 0 38px;text-transform:uppercase;letter-spacing:-.06em}nav{display:grid;gap:12px}.host{display:grid;grid-template-columns:3rem 1fr auto;align-items:center;min-height:72px;padding:14px 18px;border:1px solid #1d6170;background:#081116dd;color:inherit;text-decoration:none;clip-path:polygon(0 0,calc(100% - 10px) 0,100% 10px,100% 100%,10px 100%,0 calc(100% - 10px));transition:.15s}.host:hover,.host:focus{border-color:#73f7ff;background:#102129;transform:translateX(3px);outline:0}.number{color:#537078;font-size:.75rem}.label{font-size:1.05rem}.arrow{color:#ff59d6;font-size:2rem}footer{margin-top:28px;color:#537078;font-size:.65rem;letter-spacing:.14em}
</style></head><body><main><div class="eyebrow">gateway online</div><h1>Select<br>terminal</h1><nav>${cards}</nav><footer>TTYD_MOBILE // SECURE LINK</footer></main></body></html>`, {
    headers: {'content-type': 'text/html; charset=utf-8'},
  });
}
