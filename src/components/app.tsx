import { h, Component } from 'preact';

import { Terminal } from './terminal';

import type { ITerminalOptions, ITheme } from '@xterm/xterm';
import type { ClientOptions, FlowControl } from './terminal/xterm';
import {initialFontSize} from '../font-size';
import {initialAutoReconnect} from '../reconnect';

const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const path = window.location.pathname.replace(/[/]+$/, '');
const wsUrl = [
  protocol,
  '//',
  window.location.host,
  path,
  '/ws',
  window.location.search,
].join('');
const tokenUrl = [
  window.location.protocol,
  '//',
  window.location.host,
  path,
  '/token',
].join('');

const clientOptions = {
  rendererType: 'webgl',
  disableLeaveAlert: false,
  disableResizeOverlay: false,
  enableSixel: false,
  closeOnDisconnect: false,
  autoReconnect: initialAutoReconnect(),
  isWindows: false,
  unicodeVersion: '11',
} as ClientOptions;
const termOptions = {
  fontSize: initialFontSize(),
  fontFamily: 'Consolas,Liberation Mono,Menlo,Courier,monospace',
  theme: {
    foreground: '#d8f3e8',
    background: '#05080b',
    cursor: '#73f7ff',
    cursorAccent: '#05080b',
    selectionBackground: '#1d6170aa',
    black: '#071014',
    red: '#ff5d7d',
    green: '#73ffb2',
    yellow: '#ffd166',
    blue: '#4da6ff',
    magenta: '#ff59d6',
    cyan: '#46eaf2',
    white: '#c8d9d4',
    brightBlack: '#537078',
    brightRed: '#ff7893',
    brightGreen: '#a4ffc9',
    brightYellow: '#ffe49a',
    brightBlue: '#78bdff',
    brightMagenta: '#ff8be3',
    brightCyan: '#8af7ff',
    brightWhite: '#f4fffb',
  } as ITheme,
  allowProposedApi: true,
} as ITerminalOptions;
const flowControl = {
  limit: 100000,
  highWater: 10,
  lowWater: 4,
} as FlowControl;

export class App extends Component {
  render() {
    return (
      <Terminal
        id="terminal-container"
        wsUrl={wsUrl}
        tokenUrl={tokenUrl}
        clientOptions={clientOptions}
        termOptions={termOptions}
        flowControl={flowControl}
      />
    );
  }
}
