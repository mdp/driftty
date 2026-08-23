export interface GatewayStartupOptions {
  localTmux?: string;
  authArguments: string[];
}

export function parseGatewayStartupOptions(args: string[]): GatewayStartupOptions {
  const authArguments: string[] = [];
  let localTmux: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === '--no-auth') {
      if (authArguments.includes(argument)) {
        throw new Error('Duplicate argument: --no-auth');
      }
      authArguments.push(argument);
      continue;
    }
    if (argument === '--local-tmux') {
      if (localTmux !== undefined) {
        throw new Error('Duplicate argument: --local-tmux');
      }
      const socket = args[++index];
      if (!socket || socket.startsWith('--')) {
        throw new Error('--local-tmux requires a Unix socket path');
      }
      localTmux = socket;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  return {localTmux, authArguments};
}
