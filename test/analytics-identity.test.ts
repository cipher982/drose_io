import { describe, expect, test } from 'bun:test';
import { buildIdentityAeo } from '../server/api/analytics';

describe('identity/AEO analytics aggregation', () => {
  test('aggregates clicks, content views, and referral signals', () => {
    const result = buildIdentityAeo([
      {
        site: 'drose.io', domain: 'drose.io', id: 'drose',
        referrers: [{ x: 'https://llm-benchmarks.com/cloud', y: 3 }],
        paths: [
          { x: '/blog/aeo-personal-website-audit', y: 5 },
          { x: '/blog/another-post', y: 2 },
        ],
        events: [{ x: 'identity_link_click', y: 4 }],
        identityDestinations: [{ value: 'github_profile', total: 4 }],
      },
      {
        site: 'LLM Benchmarks', domain: 'llm-benchmarks.com', id: 'bench',
        referrers: [], paths: [],
        events: [{ x: 'identity_link_click', y: 2 }],
        identityDestinations: [{ value: 'drose_home', total: 2 }],
      },
    ], { ai: 7, search: 11 });

    expect(result.blogViews).toBe(7);
    expect(result.auditViews).toBe(5);
    expect(result.projectReferrals).toBe(3);
    expect(result.aiReferrals).toBe(7);
    expect(result.searchReferrals).toBe(11);
    expect(result.clicksBySite).toHaveLength(2);
    expect(result.clicksByDestination).toEqual([
      { destination: 'github_profile', total: 4 },
      { destination: 'drose_home', total: 2 },
    ]);
  });

  test('returns explicit zeros for an empty valid period', () => {
    const result = buildIdentityAeo([], {});
    expect(result.clicksBySite).toEqual([]);
    expect(result.clicksByDestination).toEqual([]);
    expect(result.blogViews).toBe(0);
    expect(result.auditViews).toBe(0);
  });
});
