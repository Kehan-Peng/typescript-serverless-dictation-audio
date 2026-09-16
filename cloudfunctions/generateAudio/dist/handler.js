"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createGenerateAudioHandler = createGenerateAudioHandler;
const tts_1 = require("./tts");
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
function safeErrorDetails(error) {
    if (!(error instanceof tts_1.TtsError))
        return { code: 'UNEXPECTED_ERROR' };
    return {
        code: error.code,
        provider: error.provider,
        requestId: error.requestId,
        upstreamCode: error.upstreamCode,
    };
}
function createGenerateAudioHandler(client, { provider = 'minimax', fallbackClient } = {}) {
    return async (event) => {
        if (!isValidRequest(event)) {
            return { ok: false, errorCode: 'INVALID_ARGUMENT', message: '生成参数无效，请检查后重试。' };
        }
        const startedAt = Date.now();
        try {
            let result;
            let usedProvider = provider;
            try {
                result = await client.generate(event);
            }
            catch (error) {
                const canFallback = fallbackClient &&
                    error instanceof tts_1.TtsError &&
                    (error.code === 'INPUT_TOO_LONG' ||
                        error.code === 'INPUT_UNSUPPORTED' ||
                        error.code === 'QUOTA_EXHAUSTED');
                if (!canFallback)
                    throw error;
                console.info('TTS provider fallback', {
                    provider,
                    reason: error.code,
                    fallbackProvider: 'minimax',
                });
                result = await fallbackClient.generate(event);
                usedProvider = 'minimax';
            }
            console.info('TTS success', { provider: usedProvider, elapsedMs: Date.now() - startedAt });
            return { ok: true, ...result };
        }
        catch (error) {
            const details = safeErrorDetails(error);
            console.error('TTS failed', { ...details, elapsedMs: Date.now() - startedAt });
            if (details.code === 'TIMEOUT') {
                return { ok: false, errorCode: 'TTS_TIMEOUT', message: '生成超时，请重新尝试。' };
            }
            if (details.code === 'INPUT_TOO_LONG') {
                return { ok: false, errorCode: 'TTS_FAILED', message: '词语较多，当前语音服务无法一次生成。' };
            }
            if (details.code === 'INPUT_UNSUPPORTED') {
                return { ok: false, errorCode: 'TTS_FAILED', message: '当前停顿设置不受支持，请调整后重试。' };
            }
            if (details.code === 'QUOTA_EXHAUSTED') {
                return { ok: false, errorCode: 'TTS_FAILED', message: '语音服务额度已用完，请检查配置。' };
            }
            if (details.provider === 'minimax' && details.code === 'UPSTREAM_API_ERROR' && details.upstreamCode === 1008) {
                return { ok: false, errorCode: 'TTS_FAILED', message: 'MiniMax 余额不足，请充值后重试。' };
            }
            return { ok: false, errorCode: 'TTS_FAILED', message: '生成失败，请稍后重试。' };
        }
    };
}
