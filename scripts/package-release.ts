import {assembleGatewayRelease} from './gateway-release';

const requestedVersion = process.argv[2];
if (!requestedVersion) {
  console.error('usage: npm run release:bundle -- <version>');
  process.exit(2);
}

const root = new URL('../', import.meta.url).pathname.replace(/\/$/, '');
const archive = await assembleGatewayRelease(root, requestedVersion);
console.log(archive);
