export declare function getIngestStatus(): {
    hasGatewayClient: boolean;
    hasGatewayPollTimer: boolean;
    hasSessionPollTimer: boolean;
    configuredMode: string;
    mode: string;
    reason: string;
    updatedAt: string;
    gatewayUrl: string;
    modulePath: string | null;
};
export declare function getIngestPolicyStats(): {
    stored: number;
    dropped: number;
    droppedByReason: {
        [k: string]: number;
    };
    storedByType: {
        [k: string]: number;
    };
    droppedByType: {
        [k: string]: number;
    };
    config: {
        dropUnknownSessionState: boolean;
        snapshotMinIntervalSec: number;
        healthMinIntervalSec: number;
        modelUsageMinIntervalSec: number;
        modelUsageMinTokenDelta: number;
        modelUsageMaxIntervalSec: number;
    };
};
export declare function connectToGateway(): Promise<void>;
//# sourceMappingURL=client.d.ts.map