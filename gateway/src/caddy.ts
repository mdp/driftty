export interface LegacyRoute {
  slug: string;
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
		reverse_proxy 127.0.0.1:${profile.ttydPort} ${proxyCompressionUpstream()}
	}`).join('\n');

  const sessions = sessionRoutes.map((route, index) => `
	@session${index}Bare path /${route.hostSlug}/${route.sessionSlug}
	redir @session${index}Bare /${route.hostSlug}/${route.sessionSlug}/ 308

	@session${index}Root path /${route.hostSlug}/${route.sessionSlug}/
	handle @session${index}Root {
		reverse_proxy 127.0.0.1:${pickerPort} ${proxyCompressionUpstream()}
	}

	handle /${route.hostSlug}/${route.sessionSlug}/* {
		reverse_proxy 127.0.0.1:${route.ttydPort} ${proxyCompressionUpstream()}
	}`).join('\n');

  return `{
	admin 127.0.0.1:2019
	auto_https off
}

http://:7681 {
\thandle /_health {
\t\treverse_proxy 127.0.0.1:${pickerPort}
\t}

\thandle /login* {
\t\treverse_proxy 127.0.0.1:${pickerPort}
\t}

\thandle /logout* {
\t\treverse_proxy 127.0.0.1:${pickerPort}
\t}

\thandle /watch/* {
\t\treverse_proxy 127.0.0.1:${pickerPort}
\t}

\tforward_auth 127.0.0.1:${pickerPort} {
\t\turi /_auth
\t}
${sessions}
${legacy}

	handle {
		reverse_proxy 127.0.0.1:${pickerPort} ${proxyCompressionUpstream()}
	}
}
`;

function proxyCompressionUpstream(): string {
	return `{
			header_up -Sec-WebSocket-Extensions
		}`;
}
}
