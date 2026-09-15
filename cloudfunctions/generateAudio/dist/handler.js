"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createGenerateAudioHandler = createGenerateAudioHandler;
const minimax_1 = require("./minimax");
const MAX_TEXT_CHARACTERS = 9999;
function isValidRequest(value) {
    if (!value || typeof value !== 'object')
        return false;
    const request = value;
    return (typeof request.text === 'string' &&
        request.text.trim().length > 0 &&
        Array.from(request.text).length <= MAX_TEXT_CHARACTERS &&
        typeof request.voiceId === 'string' &&
        request.voiceId.trim().length > 0 &&
        request.voiceId.length <= 256 &&
        typeof request.speed === 'number' &&
        Number.isFinite(request.speed) &&
        request.speed >= 0.5 &&
        request.speed <= 2);
}
function createGenerateAudioHandler(client) {
    return async (event) => {
        if (!isValidRequest(event)) {
            return { ok: false, errorCode: 'INVALID_ARGUMENT', message: '生成参数无效，请检查后重试。' };
        }
        const startedAt = Date.now();
        try {
            const result = await client.generate(event);
            console.info('MiniMax TTS success', { elapsedMs: Date.now() - startedAt });
            return { ok: true, ...result };
        }
        catch (error) {
            const code = error instanceof minimax_1.MiniMaxError ? error.code : 'UNEXPECTED_ERROR';
            const traceId = error instanceof minimax_1.MiniMaxError ? error.traceId : undefined;
            const upstreamStatusCode = error instanceof minimax_1.MiniMaxError ? error.upstreamStatusCode : undefined;
            const upstreamStatusMessage = error instanceof minimax_1.MiniMaxError ? error.upstreamStatusMessage : undefined;
            console.error('MiniMax TTS failed', {
                code,
                traceId,
                upstreamStatusCode,
                upstreamStatusMessage,
                elapsedMs: Date.now() - startedAt,
            });
            if (code === 'TIMEOUT') {
                return { ok: false, errorCode: 'TTS_TIMEOUT', message: '生成超时，请重新尝试。' };
            }
            if (code === 'UPSTREAM_API_ERROR' && upstreamStatusCode === 1008) {
                return { ok: false, errorCode: 'TTS_FAILED', message: 'MiniMax 余额不足，请充值后重试。' };
            }
            return { ok: false, errorCode: 'TTS_FAILED', message: '生成失败，请稍后重试。' };
        }
    };
}
