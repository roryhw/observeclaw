export type NetworkDirection = 'outbound' | 'inbound';
export type NetworkExcludeReason = 'localhost' | 'model_provider' | 'channel_provider' | 'denylist';
export interface NetworkPolicyConfig {
    logIncoming: boolean;
    excludeLocalhost: boolean;
    excludeModelHosts: boolean;
    excludeChannelHosts: boolean;
    denyHosts: string[];
    denyCidrs: string[];
    modelHosts: string[];
    modelCidrs: string[];
    channelHosts: string[];
    channelCidrs: string[];
}
export interface NetworkPolicyDecision {
    allow: boolean;
    reason?: NetworkExcludeReason;
}
export declare function normalizeHost(host: string): string;
export declare function isLocalhost(host: string): boolean;
export declare function loadNetworkPolicyConfig(env?: NodeJS.ProcessEnv): NetworkPolicyConfig;
export declare function evaluateNetworkPolicy(cfg: NetworkPolicyConfig, direction: NetworkDirection, host: string): NetworkPolicyDecision;
//# sourceMappingURL=policy.d.ts.map