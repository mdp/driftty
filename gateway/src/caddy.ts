import type {Profile} from './profiles';

export interface LegacyRoute extends Profile {
  ttydPort: number;
}

export interface SessionRoute {
  hostSlug: string;
  sessionSlug: string;
  ttydPort: number;
}

export function caddyConfig(
  legacyRoutes: LegacyRoute[],
  sessionRoutes: SessionRoute[],
  pickerPort = 7799,
): string {
  const legacy = legacyRoutes.map((profile) => `
	@${profile.slug}Bare path /${profile.slug}
	redir @${profile.slug}Bare /${profile.slug}/ 308

	handle /${profile.slug}/* {
		reverse_proxy 127.0.0.1:${profile.ttydPort}
	}`).join('\n');

  const sessions = sessionRoutes.map((route, index) => `
	@session${index}Bare path /${route.hostSlug}/${route.sessionSlug}
	redir @session${index}Bare /${route.hostSlug}/${route.sessionSlug}/ 308

	@session${index}Root path /${route.hostSlug}/${route.sessionSlug}/
	handle @session${index}Root {
		reverse_proxy 127.0.0.1:${pickerPort}
	}

	handle /${route.hostSlug}/${route.sessionSlug}/* {
		reverse_proxy 127.0.0.1:${route.ttydPort}
	}`).join('\n');

  return `{
	admin 127.0.0.1:2019
	auto_https off
}

http://:7681 {
${sessions}
${legacy}

	handle {
		reverse_proxy 127.0.0.1:${pickerPort}
	}
}
`;
}
