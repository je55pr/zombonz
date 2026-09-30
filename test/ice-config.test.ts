import { describe, expect, it } from 'vitest';
import { DEFAULT_STUN_URLS, buildIceConfiguration } from '../src/network/ice.ts';

describe('ICE deployment configuration', () => {
  it('uses the current public STUN defaults when no environment values are supplied', () => {
    const config = buildIceConfiguration({});
    expect(config.stunUrls).toEqual([...DEFAULT_STUN_URLS]);
    expect(config.servers).toEqual([{ urls: [...DEFAULT_STUN_URLS] }]);
    expect(config.turnConfigured).toBe(false);
    expect(config.problem).toBeNull();
  });

  it('externalizes STUN URLs as a comma or whitespace separated deployment value', () => {
    const config = buildIceConfiguration({ VITE_STUN_URLS: 'stun:one.example:3478, stun:two.example:3478\nstun:three.example:3478' });
    expect(config.stunUrls).toEqual([
      'stun:one.example:3478',
      'stun:two.example:3478',
      'stun:three.example:3478',
    ]);
  });

  it('adds a credentialled TURN fallback without putting credentials in source defaults', () => {
    const config = buildIceConfiguration({
      VITE_TURN_URLS: 'turn:relay.example:3478?transport=udp,turns:relay.example:5349?transport=tcp',
      VITE_TURN_USERNAME: 'temporary-user',
      VITE_TURN_CREDENTIAL: 'temporary-password',
    });
    expect(config.turnConfigured).toBe(true);
    expect(config.problem).toBeNull();
    expect(config.turnServers).toEqual([{
      urls: ['turn:relay.example:3478?transport=udp', 'turns:relay.example:5349?transport=tcp'],
      username: 'temporary-user',
      credential: 'temporary-password',
    }]);
    expect(config.servers).toEqual([{ urls: [...DEFAULT_STUN_URLS] }, ...config.turnServers]);
  });

  it('refuses incomplete TURN deployment settings instead of silently creating a broken relay entry', () => {
    const missingCredential = buildIceConfiguration({
      VITE_TURN_URLS: 'turn:relay.example:3478',
      VITE_TURN_USERNAME: 'temporary-user',
    });
    expect(missingCredential.turnConfigured).toBe(false);
    expect(missingCredential.turnServers).toEqual([]);
    expect(missingCredential.problem).toMatch(/credential is missing/i);

    const missingUrl = buildIceConfiguration({
      VITE_TURN_USERNAME: 'temporary-user',
      VITE_TURN_CREDENTIAL: 'temporary-password',
    });
    expect(missingUrl.problem).toMatch(/no TURN URL/i);
  });
});
