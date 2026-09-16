"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TtsError = void 0;
exports.resolveTtsProvider = resolveTtsProvider;
function resolveTtsProvider(configuredProvider, hasTencentCredentials) {
    const normalized = configuredProvider?.trim().toLowerCase();
    if (normalized === 'minimax' || normalized === 'tencent')
        return normalized;
    return hasTencentCredentials ? 'tencent' : 'minimax';
}
class TtsError extends Error {
    constructor(code, provider, requestId, upstreamCode) {
        super(code);
        this.code = code;
        this.provider = provider;
        this.requestId = requestId;
        this.upstreamCode = upstreamCode;
        this.name = 'TtsError';
    }
}
exports.TtsError = TtsError;
