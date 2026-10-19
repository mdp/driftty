import {describe, expect, test} from 'bun:test';
import {vercelCredentials} from './vercel';

describe('Vercel Sandbox configuration', () => {
  test('requires token, team, and project without exposing their values', () => {
    expect(() => vercelCredentials({})).toThrow(
      'Missing Vercel Sandbox configuration: VERCEL_TOKEN, VERCEL_TEAM_ID, VERCEL_PROJECT_ID',
    );
  });

  test('returns credentials for the SDK', () => {
    expect(vercelCredentials({
      VERCEL_TOKEN: 'token-value',
      VERCEL_TEAM_ID: 'team-value',
      VERCEL_PROJECT_ID: 'project-value',
    })).toEqual({
      token: 'token-value',
      teamId: 'team-value',
      projectId: 'project-value',
    });
  });
});
