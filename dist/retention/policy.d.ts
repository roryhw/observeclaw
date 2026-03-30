export type RetentionRule = {
    pattern: string;
    days: number;
    enabled?: boolean;
};
export type RetentionPolicy = {
    id: string;
    name: string;
    enabled: boolean;
    timezone: string;
    scheduleCron: string;
    includeInferred: boolean;
    chatRetentionDays: number;
    defaultRetentionDays: number;
    auditRetentionDays: number;
    notifyOnFailureOnly: boolean;
    rules: RetentionRule[];
    createdAt: string;
    updatedAt: string;
};
export declare function isInferredEvent(type: string, data: any, summary?: string): boolean;
export declare function defaultPolicy(nowIso?: string): RetentionPolicy;
export declare function loadPolicy(db: any): RetentionPolicy;
export declare function savePolicy(db: any, input: Partial<RetentionPolicy>): RetentionPolicy;
export declare function retentionPreview(db: any, policy: RetentionPolicy, nowMs?: number): {
    byType: {
        type: string;
        keepDays: number;
        total: number;
        purge: number;
    }[];
    purgeNormalized: number;
    purgeAudit: any;
    auditCutoff: string;
};
export declare function runRetention(db: any, policy: RetentionPolicy, opts?: {
    dryRun?: boolean;
    runVacuum?: boolean;
    runCheckpoint?: boolean;
}): {
    noisyAuditCutoff: string;
    normalizedDeleted: number;
    auditDeleted: number;
    noisyAuditDeleted: number;
    rawDeleted: number;
    checkpointRan: boolean;
    vacuumRan: boolean;
    byType: {
        type: string;
        keepDays: number;
        total: number;
        purge: number;
    }[];
    purgeNormalized: number;
    purgeAudit: any;
    auditCutoff: string;
} | {
    noisyAuditCutoff: string;
    deletedByType: {
        type: string;
        deleted: number;
        keepDays: number;
    }[];
    normalizedDeleted: number;
    auditDeleted: number;
    noisyAuditDeleted: number;
    rawDeleted: number;
    checkpointRan: boolean;
    vacuumRan: boolean;
    byType: {
        type: string;
        keepDays: number;
        total: number;
        purge: number;
    }[];
    purgeNormalized: number;
    purgeAudit: any;
    auditCutoff: string;
};
//# sourceMappingURL=policy.d.ts.map