const SECRET_KEYS = new Set([
    'token',
    'apikey',
    'api_key',
    'password',
    'secret',
    'authorization',
    'cookie',
    'bearer',
    'sessiontoken',
    'privatekey'
]);
const DEFAULT_ALLOWLIST = new Set([
    'model',
    'tokens',
    'cost',
    'state',
    'tool',
    'summary',
    'session',
    'sessionKey',
    'agent',
    'agentId',
    'channel',
    'kind',
    'label',
    'updatedAt',
    'count',
    'inferred',
    'service',
    'severity',
    'type',
    'domain',
    'host',
    'port',
    'protocol',
    'url',
    'statusCode',
    'durationMs',
    'bytesIn',
    'bytesOut',
    'resolvedIp'
]);
export function redactObject(input, mode = 'best-effort') {
    if (input === null || input === undefined)
        return input;
    if (typeof input === 'string') {
        if (/bearer\s+[a-z0-9\-_.=]+/i.test(input))
            return '***REDACTED***';
        if (input.length > 80 && /[A-Za-z0-9_\-]{40,}/.test(input))
            return '***REDACTED***';
        return input;
    }
    if (Array.isArray(input))
        return input.map((x) => redactObject(x, mode));
    if (typeof input === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(input)) {
            const key = String(k);
            const lower = key.toLowerCase();
            if (SECRET_KEYS.has(lower)) {
                out[key] = '***REDACTED***';
                continue;
            }
            if (mode === 'allowlist' && !DEFAULT_ALLOWLIST.has(key) && !DEFAULT_ALLOWLIST.has(lower)) {
                out[key] = '[FILTERED]';
                continue;
            }
            out[key] = redactObject(v, mode);
        }
        return out;
    }
    return input;
}
export function containsSecretLikeString(value) {
    if (!value)
        return false;
    if (/bearer\s+[a-z0-9\-_.=]+/i.test(value))
        return true;
    if (/sk-[A-Za-z0-9]{20,}/.test(value))
        return true;
    if (/[A-Za-z0-9_\-]{48,}/.test(value))
        return true;
    return false;
}
//# sourceMappingURL=redaction.js.map