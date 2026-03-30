import assert from 'node:assert/strict';
import {
  evaluateNetworkPolicy,
  isLocalhost,
  loadNetworkPolicyConfig,
  normalizeHost,
  type NetworkPolicyConfig
} from './policy.js';

function baseCfg(): NetworkPolicyConfig {
  return {
    logIncoming: true,
    excludeLocalhost: true,
    excludeModelHosts: true,
    excludeChannelHosts: true,
    denyHosts: ['blocked.example.com'],
    denyCidrs: ['203.0.113.0/24'],
    modelHosts: ['api.openai.com'],
    modelCidrs: ['198.51.100.0/24'],
    channelHosts: ['api.telegram.org'],
    channelCidrs: ['149.154.166.110/32']
  };
}

function run() {
  assert.equal(normalizeHost('[FE80::1]'), 'fe80::1');
  assert.equal(isLocalhost('localhost'), true);
  assert.equal(isLocalhost('127.0.0.1'), true);
  assert.equal(isLocalhost('10.0.0.2'), true);
  assert.equal(isLocalhost('api.openai.com'), false);

  const cfg = baseCfg();

  // outbound localhost excluded
  let d = evaluateNetworkPolicy(cfg, 'outbound', 'localhost');
  assert.equal(d.allow, false);
  assert.equal(d.reason, 'localhost');

  // outbound model host excluded
  d = evaluateNetworkPolicy(cfg, 'outbound', 'api.openai.com');
  assert.equal(d.allow, false);
  assert.equal(d.reason, 'model_provider');

  // outbound model CIDR excluded
  d = evaluateNetworkPolicy(cfg, 'outbound', '198.51.100.77');
  assert.equal(d.allow, false);
  assert.equal(d.reason, 'model_provider');

  // outbound channel host excluded
  d = evaluateNetworkPolicy(cfg, 'outbound', 'api.telegram.org');
  assert.equal(d.allow, false);
  assert.equal(d.reason, 'channel_provider');

  // outbound channel CIDR excluded
  d = evaluateNetworkPolicy(cfg, 'outbound', '149.154.166.110');
  assert.equal(d.allow, false);
  assert.equal(d.reason, 'channel_provider');

  // denylist precedence still excludes
  d = evaluateNetworkPolicy(cfg, 'outbound', 'blocked.example.com');
  assert.equal(d.allow, false);
  assert.equal(d.reason, 'denylist');

  // inbound non-localhost allowed unless denied
  d = evaluateNetworkPolicy(cfg, 'inbound', 'example.com');
  assert.equal(d.allow, true);

  d = evaluateNetworkPolicy(cfg, 'inbound', 'blocked.example.com');
  assert.equal(d.allow, false);
  assert.equal(d.reason, 'denylist');

  d = evaluateNetworkPolicy(cfg, 'inbound', '203.0.113.55');
  assert.equal(d.allow, false);
  assert.equal(d.reason, 'denylist');

  // env load defaults
  const envCfg = loadNetworkPolicyConfig({
    OBSERVECLAW_NETWORK_LOG_INCOMING: '1',
    OBSERVECLAW_NETWORK_EXCLUDE_LOCALHOST: '1',
    OBSERVECLAW_NETWORK_EXCLUDE_MODEL_HOSTS: '1',
    OBSERVECLAW_NETWORK_EXCLUDE_CHANNEL_HOSTS: '1',
    OBSERVECLAW_NETWORK_DENY_HOSTS: 'foo.com, bar.com',
    OBSERVECLAW_NETWORK_DENY_CIDRS: '10.0.0.0/8, 198.51.100.0/24',
    OBSERVECLAW_NETWORK_MODEL_HOSTS: 'm1.com,m2.com',
    OBSERVECLAW_NETWORK_MODEL_CIDRS: '203.0.113.0/24',
    OBSERVECLAW_NETWORK_CHANNEL_HOSTS: 'c1.com,c2.com',
    OBSERVECLAW_NETWORK_CHANNEL_CIDRS: '149.154.166.110/32'
  } as any);

  assert.deepEqual(envCfg.denyHosts, ['foo.com', 'bar.com']);
  assert.deepEqual(envCfg.modelHosts, ['m1.com', 'm2.com']);
  assert.deepEqual(envCfg.channelHosts, ['c1.com', 'c2.com']);
  assert.deepEqual(envCfg.denyCidrs, ['10.0.0.0/8', '198.51.100.0/24']);
  assert.deepEqual(envCfg.modelCidrs, ['203.0.113.0/24']);
  assert.deepEqual(envCfg.channelCidrs, ['149.154.166.110/32']);

  console.log('policy.test.ts: OK');
}

run();
