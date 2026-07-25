export const terminalKeys = [
  {label: 'Tab', sequence: '\t', title: 'Tab'},
  {label: '⇧ Tab', sequence: '\x1b[Z', title: 'Shift+Tab'},
  {label: 'Esc', sequence: '\x1b', title: 'Escape'},
  {label: '←', sequence: '\x1b[D', title: 'Left Arrow'},
  {label: '↑', sequence: '\x1b[A', title: 'Up Arrow'},
  {label: '↓', sequence: '\x1b[B', title: 'Down Arrow'},
  {label: '→', sequence: '\x1b[C', title: 'Right Arrow'},
  {label: 'Ctrl-C', sequence: '\x03', title: 'Interrupt (Ctrl-C)'},
  {label: 'Ctrl-D', sequence: '\x04', title: 'End of input (Ctrl-D)'},
  {label: 'Ctrl-L', sequence: '\x0c', title: 'Clear screen (Ctrl-L)'},
] as const;
