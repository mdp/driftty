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
  authEnabled = true,
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

  const authentication = authEnabled
    ? `	@protected not path /login /logout /_health
	forward_auth @protected 127.0.0.1:${pickerPort} {
		uri /_auth
	}
`
    : '';

  const route = `
	@health path /_health
	handle @health {
		reverse_proxy 127.0.0.1:${pickerPort}
	}

	@login path /login
	handle @login {
		reverse_proxy 127.0.0.1:${pickerPort} {
			header_up X-Forwarded-Proto {http.request.header.X-Forwarded-Proto}
		}
	}

	@logout path /logout
	handle @logout {
		reverse_proxy 127.0.0.1:${pickerPort} {
			header_up X-Forwarded-Proto {http.request.header.X-Forwarded-Proto}
		}
	}

${authentication}${sessions}
${legacy}

	handle {
		reverse_proxy 127.0.0.1:${pickerPort} ${proxyCompressionUpstream()}
	}
	`;

  return `{
	admin 127.0.0.1:2019
	auto_https off
}

http://:7681 {
	route {
${indentForRoute(route)}
	}
}
`;

function proxyCompressionUpstream(): string {
	return `{
			header_up -Sec-WebSocket-Extensions
		}`;
}

function indentForRoute(source: string): string {
  return source.replace(/^\n/, '').trimEnd().replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.length > 0 ? `\t${line}` : line)
    .join('\n');
}
}
