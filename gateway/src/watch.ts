import {isAuthenticated} from './auth';
import type {GatewayAuthConfig} from './gateway-plan';

interface WatchData {
  route: string;
  kind: 'writer' | 'viewer';
}

interface Snapshot {
  columns: number;
  rows: number;
  lines: string[];
  updatedAt: number;
}

type Socket = ServerWebSocket<WatchData>;

export class WatchHub {
  private readonly viewers = new Map<string, Set<Socket>>();
  private readonly snapshots = new Map<string, Snapshot>();

  upgrade(
    request: Request,
    route: string,
    kind: WatchData['kind'],
    auth: GatewayAuthConfig,
    server: {upgrade(request: Request, options: {data: WatchData}): boolean},
  ): Response | undefined {
    if (kind === 'writer' && !isAuthenticated(request, auth)) {
      return new Response('Authentication required', {status: 401});
    }
    if (kind === 'viewer') {
      const upgraded = server.upgrade(request, {data: {route, kind}});
      return upgraded ? undefined : new Response('WebSocket upgrade failed', {status: 400});
    }
    const upgraded = server.upgrade(request, {data: {route, kind}});
    return upgraded ? undefined : new Response('WebSocket upgrade failed', {status: 400});
  }

  open(socket: Socket): void {
    if (socket.data.kind === 'viewer') {
      const clients = this.viewers.get(socket.data.route) ?? new Set<Socket>();
      clients.add(socket);
      this.viewers.set(socket.data.route, clients);
      const snapshot = this.snapshots.get(socket.data.route);
      if (snapshot) socket.send(JSON.stringify(snapshot));
    }
  }

  message(socket: Socket, message: string | Buffer): void {
    if (socket.data.kind !== 'writer') return;
    try {
      const snapshot = JSON.parse(String(message)) as Snapshot;
      if (!validSnapshot(snapshot)) return;
      this.snapshots.set(socket.data.route, snapshot);
      for (const viewer of this.viewers.get(socket.data.route) ?? []) {
        viewer.send(JSON.stringify(snapshot));
      }
    } catch {
      // Ignore malformed browser messages.
    }
  }

  close(socket: Socket): void {
    if (socket.data.kind !== 'viewer') return;
    const clients = this.viewers.get(socket.data.route);
    clients?.delete(socket);
    if (clients?.size === 0) this.viewers.delete(socket.data.route);
  }
}

function validSnapshot(value: Snapshot): boolean {
  return Number.isInteger(value.columns) && value.columns > 0 &&
    Number.isInteger(value.rows) && value.rows > 0 &&
    Array.isArray(value.lines) && value.lines.length === value.rows &&
    value.lines.every((line) => typeof line === 'string');
}

export function watchPage(route: string): Response {
  const socket = `/watch/${route}/stream`;
  return new Response(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no"><title>Watch — driftty</title><style>*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#05080b;color:#d8f3e8}body{touch-action:none}#screen{position:absolute;left:0;top:0;transform-origin:top left;white-space:pre;font:13px/1.2 "JetBrains Mono Nerd Font",ui-monospace,monospace;padding:10px;user-select:text;color:#d8f3e8}.status{position:fixed;z-index:2;right:10px;top:10px;padding:5px 8px;background:#081116cc;color:#73f7ff;font:11px ui-monospace,monospace;letter-spacing:.08em}</style><div class="status">LIVE</div><pre id="screen">Waiting for writer...</pre><script>const screen=document.querySelector('#screen'),status=document.querySelector('.status');let scale=1,x=0,y=0,start;function draw(s){screen.textContent=s.lines.join('\\n');screen.style.width=(s.columns*8)+'px';screen.style.height=(s.rows*16)+'px';fit(s.columns*8+20,s.rows*16+20)}function fit(w,h){scale=Math.min(innerWidth/w,innerHeight/h);x=(innerWidth-w*scale)/2;y=(innerHeight-h*scale)/2;apply()}function apply(){screen.style.transform='translate('+x+'px,'+y+'px) scale('+scale+')'}let last;addEventListener('pointerdown',e=>{last={x:e.clientX,y:e.clientY};screen.setPointerCapture?.(e.pointerId)});addEventListener('pointermove',e=>{if(!last)return;x+=e.clientX-last.x;y+=e.clientY-last.y;last={x:e.clientX,y:e.clientY};apply()});addEventListener('pointerup',()=>last=undefined);addEventListener('wheel',e=>{e.preventDefault();const next=Math.max(.5,Math.min(4,scale*(e.deltaY<0?1.1:.9)));scale=next;apply()},{passive:false});const ws=new WebSocket((location.protocol==='https:'?'wss:':'ws:')+'//'+location.host+'${socket}');ws.onmessage=e=>{draw(JSON.parse(e.data));status.textContent='LIVE'};ws.onclose=()=>status.textContent='OFFLINE';</script>`, {headers:{'content-type':'text/html; charset=utf-8'}});
}
