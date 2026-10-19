import {randomUUID} from 'node:crypto';
import {VercelWorkspaceProvider} from '../src/workspace/providers/vercel';

const provider = new VercelWorkspaceProvider();
const name = `driftty-smoke-${randomUUID().slice(0, 8)}`;
let handle: Awaited<ReturnType<typeof provider.create>> | undefined;
let destroyed = false;
try {
  handle = await provider.create({name});
  console.log(`Created Vercel sandbox ${handle.name}`);

  const write = await provider.exec(handle, {
    cmd: 'bash',
    args: ['-lc', 'mkdir -p /workspace && printf %s lifecycle-ok > /workspace/test.txt'],
  });
  if (write.exitCode !== 0) throw new Error(`write failed (${write.exitCode}): ${write.stderr}`);

  await provider.stop(handle);
  let status = await provider.status(handle);
  for (let attempt = 0; status !== 'stopped' && attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    status = await provider.status(handle);
  }
  if (status !== 'stopped') throw new Error(`sandbox did not stop; status=${status}`);
  console.log('Stopped without losing sandbox identity');

  await provider.resume(handle);
  const read = await provider.exec(handle, {
    cmd: 'cat',
    args: ['/workspace/test.txt'],
  });
  if (read.exitCode !== 0 || read.stdout !== 'lifecycle-ok') {
    throw new Error(`resume verification failed (exit=${read.exitCode})`);
  }
  console.log('Resumed sandbox and verified /workspace/test.txt');

  await provider.destroy(handle);
  destroyed = true;
  console.log('Destroyed sandbox and orphan snapshots');
} finally {
  if (handle && !destroyed) {
    try {
      await provider.destroy(handle);
      console.log('Cleaned up incomplete lifecycle test sandbox');
    } catch {
      console.error(`Cleanup required: sandbox ${handle.name} may still exist`);
    }
  }
}
