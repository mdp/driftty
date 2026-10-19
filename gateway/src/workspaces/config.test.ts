import {describe, expect, test} from 'bun:test';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readProjectDefinitions} from './config';

describe('workspace project definitions', () => {
  test('loads project checkout and setup instructions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'driftty-projects-'));
    const path = join(directory, 'projects.yaml');
    try {
      await writeFile(path, `projects:\n  - id: demo\n    label: Demo\n    provider: vercel\n    repository:\n      url: https://example.test/demo.git\n      branch: main\n      directory: /workspace/demo\n    dotfiles:\n      repository: mdp/dotfiles\n      branch: main\n    setup:\n      - name: dependencies\n        run: npm ci\n`);
      const projects = await readProjectDefinitions(path);
      expect(projects.get('demo')).toEqual({
        id: 'demo', label: 'Demo', provider: 'vercel',
        repository: {url: 'https://example.test/demo.git', branch: 'main', directory: '/workspace/demo'},
        dotfiles: {repository: 'mdp/dotfiles', branch: 'main'},
        setup: [{name: 'dependencies', run: 'npm ci'}],
      });
    } finally {
      await rm(directory, {recursive: true, force: true});
    }
  });

  test('loads ordinary project environment bindings', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'driftty-projects-'));
    const path = join(directory, 'projects.yaml');
    try {
      await writeFile(path, `projects:\n  - id: demo\n    label: Demo\n    provider: vercel\n    repository:\n      url: https://example.test/demo.git\n      directory: /workspace/demo\n    secrets:\n      env:\n        GH_TOKEN: shared:GITHUB_TOKEN\n        POSTHOG_PERSONAL_API_KEY: BB_POSTHOG_PERSONAL_API_KEY\n`);
      const projects = await readProjectDefinitions(path);
      expect(projects.get('demo')?.secrets).toEqual({
        env: {GH_TOKEN: 'shared:GITHUB_TOKEN', POSTHOG_PERSONAL_API_KEY: 'BB_POSTHOG_PERSONAL_API_KEY'},
      });
    } finally {
      await rm(directory, {recursive: true, force: true});
    }
  });

  test('rejects the old contract and invalid destinations', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'driftty-projects-'));
    const path = join(directory, 'projects.yaml');
    try {
      await writeFile(path, `projects:\n  - id: demo\n    label: Demo\n    provider: vercel\n    repository:\n      url: https://example.test/demo.git\n      directory: /workspace/demo\n    sandbox_secrets:\n      OPENAI_API_KEY: DRIFTTY_OPENAI_API_KEY\n`);
      await expect(readProjectDefinitions(path)).rejects.toThrow('sandbox_secrets is unsupported');
      await writeFile(path, `projects:\n  - id: demo\n    label: Demo\n    provider: vercel\n    repository:\n      url: https://example.test/demo.git\n      directory: /workspace/demo\n    secrets:\n      env:\n        PATH: PATH_SECRET\n`);
      await expect(readProjectDefinitions(path)).rejects.toThrow('invalid or reserved');
      await writeFile(path, `projects:\n  - id: demo\n    label: Demo\n    provider: vercel\n    repository:\n      url: https://example.test/demo.git\n      directory: /workspace/demo\n    secrets:\n      env:\n        APP_TOKEN: VERCEL_TOKEN\n`);
      await expect(readProjectDefinitions(path)).rejects.toThrow('invalid or reserved');
    } finally {
      await rm(directory, {recursive: true, force: true});
    }
  });

  test('rejects dotfiles sources that are not public GitHub owner/repository names', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'driftty-projects-'));
    const path = join(directory, 'projects.yaml');
    try {
      await writeFile(path, `projects:\n  - id: demo\n    label: Demo\n    provider: vercel\n    repository:\n      url: https://example.test/demo.git\n      directory: /workspace/demo\n    dotfiles:\n      repository: https://github.com/mdp/dotfiles.git\n`);
      await expect(readProjectDefinitions(path)).rejects.toThrow('public GitHub owner/repository');
    } finally {
      await rm(directory, {recursive: true, force: true});
    }
  });

  test('rejects unsafe checkout directories and unsupported providers', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'driftty-projects-'));
    const path = join(directory, 'projects.yaml');
    try {
      await writeFile(path, `projects:\n  - id: demo\n    label: Demo\n    provider: ssh\n    repository:\n      url: https://example.test/demo.git\n      directory: /workspace/demo\n`);
      await expect(readProjectDefinitions(path)).rejects.toThrow('provider must be vercel');
      await writeFile(path, `projects:\n  - id: demo\n    label: Demo\n    provider: vercel\n    repository:\n      url: https://example.test/demo.git\n      directory: /workspace/../escape\n`);
      await expect(readProjectDefinitions(path)).rejects.toThrow('safe absolute path');
    } finally {
      await rm(directory, {recursive: true, force: true});
    }
  });
});
