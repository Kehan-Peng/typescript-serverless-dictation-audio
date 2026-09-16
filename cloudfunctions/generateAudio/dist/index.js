"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = void 0;
const handler_1 = require("./handler");
const minimax_1 = require("./minimax");
const tencent_1 = require("./tencent");
const tts_1 = require("./tts");
const miniMaxClient = (0, minimax_1.createMiniMaxClient)({
    apiKey: process.env.MINIMAX_API_KEY ?? '',
});
const hasTencentCredentials = Boolean(process.env.TENCENT_SECRET_ID?.trim() && process.env.TENCENT_SECRET_KEY?.trim());
const provider = (0, tts_1.resolveTtsProvider)(process.env.TTS_PROVIDER, hasTencentCredentials);
function getTencentVoiceType() {
    const configured = Number(process.env.TENCENT_TTS_VOICE_TYPE);
    return Number.isInteger(configured) && configured > 0 ? configured : tencent_1.TENCENT_DEFAULT_VOICE_TYPE;
}
function createMainHandler() {
    if (provider === 'minimax')
        return (0, handler_1.createGenerateAudioHandler)(miniMaxClient);
    const secretId = process.env.TENCENT_SECRET_ID ?? '';
    const secretKey = process.env.TENCENT_SECRET_KEY ?? '';
    const tencentClient = (0, tencent_1.createTencentClient)({
        secretId,
        secretKey,
        voiceType: getTencentVoiceType(),
        transport: (0, tencent_1.createTencentSdkTransport)({
            secretId,
            secretKey,
            region: process.env.TENCENT_TTS_REGION ?? '',
        }),
    });
    return (0, handler_1.createGenerateAudioHandler)(tencentClient, {
        provider: 'tencent',
        ...(process.env.MINIMAX_API_KEY?.trim() ? { fallbackClient: miniMaxClient } : {}),
    });
}
exports.main = createMainHandler();
