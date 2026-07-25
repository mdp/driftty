import type {Profile} from './profiles';

export interface RouteProfile extends Profile {
  ttydPort: number;
}

export function caddyConfig(profiles: RouteProfile[], pickerPort = 7799): string {
  const routes = profiles.map((profile) => `
	@${profile.slug}Bare path /${profile.slug}
	redir @${profile.slug}Bare /${profile.slug}/ 308

	handle /${profile.slug}/* {
		reverse_proxy 127.0.0.1:${profile.ttydPort}
	}`).join('\n');

  return `{
	admin off
	auto_https off
}

http://:7681 {
	@root path /
	handle @root {
		reverse_proxy 127.0.0.1:${pickerPort}
	}
${routes}

	handle {
		respond "Not found" 404
	}
}
`;
}
