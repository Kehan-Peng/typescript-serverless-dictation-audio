"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TENCENT_MAX_SPOKEN_CHARACTERS = exports.TENCENT_DEFAULT_VOICE_TYPE = void 0;
exports.escapeXml = escapeXml;
exports.getTencentSpokenTextLength = getTencentSpokenTextLength;
exports.convertDictationTextToTencentSsml = convertDictationTextToTencentSsml;
exports.createTencentClient = createTencentClient;
exports.createTencentSdkTransport = createTencentSdkTransport;
const node_crypto_1 = require("node:crypto");
const tts_1 = require("./tts");
exports.TENCENT_DEFAULT_VOICE_TYPE = 101011;
exports.TENCENT_MAX_SPOKEN_CHARACTERS = 150;
const PAUSE_MARKER = /<#(\d+(?:\.\d{1,2})?)#>/g;
const TENCENT_ENDPOINT = 'tts.tencentcloudapi.com';
const REQUEST_TIMEOUT_SECONDS = 45;
function parseDictationText(text) {
    if (!text.trim())
        throw new tts_1.TtsError('INPUT_UNSUPPORTED', 'tencent');
    const parts = [];
    let cursor = 0;
    PAUSE_MARKER.lastIndex = 0;
    for (let match = PAUSE_MARKER.exec(text); match; match = PAUSE_MARKER.exec(text)) {
        const readableText = text.slice(cursor, match.index);
        if (!readableText || readableText.includes('<#') || readableText.includes('#>')) {
            throw new tts_1.TtsError('INPUT_UNSUPPORTED', 'tencent');
        }
        parts.push({ text: readableText, pauseSeconds: Number(match[1]) });
        cursor = match.index + match[0].length;
    }
    const trailingText = text.slice(cursor);
    if (!trailingText || trailingText.includes('<#') || trailingText.includes('#>')) {
        throw new tts_1.TtsError('INPUT_UNSUPPORTED', 'tencent');
    }
    parts.push({ text: trailingText });
    return parts;
}
function escapeXml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}
function buildBreakTags(pauseSeconds) {
    if (!Number.isFinite(pauseSeconds) || pauseSeconds < 0.01 || pauseSeconds > 99.99) {
        throw new tts_1.TtsError('INPUT_UNSUPPORTED', 'tencent');
    }
    let centiseconds = Math.round(pauseSeconds * 100);
    if (Math.abs(centiseconds / 100 - pauseSeconds) > 1e-9 || centiseconds < 5) {
        // Tencent SSML's smallest legal break is 50ms.
        throw new tts_1.TtsError('INPUT_UNSUPPORTED', 'tencent');
    }
    const tags = [];
    while (centiseconds >= 1000) {
        tags.push('<break time="10s"/>');
        centiseconds -= 1000;
    }
    if (centiseconds > 0) {
        if (centiseconds % 100 === 0)
            tags.push(`<break time="${centiseconds / 100}s"/>`);
        else
            tags.push(`<break time="${centiseconds * 10}ms"/>`);
    }
    return tags.join('');
}
function getTencentSpokenTextLength(text) {
    return parseDictationText(text).reduce((total, part) => total + Array.from(part.text).length, 0);
}
function convertDictationTextToTencentSsml(text) {
    const content = parseDictationText(text)
        .map((part) => `${escapeXml(part.text)}${part.pauseSeconds === undefined ? '' : buildBreakTags(part.pauseSeconds)}`)
        .join('');
    return `<speak>${content}</speak>`;
}
function isBase64Audio(value) {
    return (typeof value === 'string' &&
        value.length >= 4 &&
        value.length % 4 === 0 &&
        /^[A-Za-z0-9+/]+={0,2}$/.test(value));
}
function readErrorField(error, field) {
    if (!error || typeof error !== 'object')
        return undefined;
    const value = error[field];
    return typeof value === 'string' ? value : undefined;
}
function isTimeoutError(error) {
    const code = readErrorField(error, 'code')?.toLowerCase();
    const name = error instanceof Error ? error.name.toLowerCase() : '';
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    return (code === 'etimedout' ||
        code === 'econnaborted' ||
        code === 'requesttimeout' ||
        name.includes('timeout') ||
        message.includes('timeout') ||
        message.includes('timed out'));
}
function createTencentClient({ secretId, secretKey, voiceType = exports.TENCENT_DEFAULT_VOICE_TYPE, transport, }) {
    return {
        async generate(request) {
            if (!secretId.trim() || !secretKey.trim() || !Number.isInteger(voiceType) || voiceType <= 0) {
                throw new tts_1.TtsError('CONFIG_ERROR', 'tencent');
            }
            if (getTencentSpokenTextLength(request.text) > exports.TENCENT_MAX_SPOKEN_CHARACTERS) {
                throw new tts_1.TtsError('INPUT_TOO_LONG', 'tencent');
            }
            const sdkRequest = {
                Text: convertDictationTextToTencentSsml(request.text),
                SessionId: (0, node_crypto_1.randomUUID)(),
                Volume: 0,
                Speed: 0,
                ProjectId: 0,
                ModelType: 1,
                VoiceType: voiceType,
                PrimaryLanguage: 1,
                SampleRate: 16000,
                Codec: 'mp3',
                EnableSubtitle: false,
            };
            let response;
            try {
                response = await transport(sdkRequest);
            }
            catch (error) {
                const requestId = readErrorField(error, 'requestId');
                const upstreamCode = readErrorField(error, 'code');
                if (isTimeoutError(error))
                    throw new tts_1.TtsError('TIMEOUT', 'tencent', requestId, upstreamCode);
                if (upstreamCode === 'UnsupportedOperation.NoFreeAccount' ||
                    upstreamCode === 'UnsupportedOperation.PkgExhausted') {
                    throw new tts_1.TtsError('QUOTA_EXHAUSTED', 'tencent', requestId, upstreamCode);
                }
                throw new tts_1.TtsError('UPSTREAM_API_ERROR', 'tencent', requestId, upstreamCode);
            }
            if (!response || typeof response !== 'object') {
                throw new tts_1.TtsError('INVALID_RESPONSE', 'tencent');
            }
            const requestId = typeof response.RequestId === 'string' ? response.RequestId : undefined;
            if (!isBase64Audio(response.Audio)) {
                throw new tts_1.TtsError('INVALID_RESPONSE', 'tencent', requestId);
            }
            return { audioBase64: response.Audio };
        },
    };
}
function createTencentSdkTransport({ secretId, secretKey, region = '', }) {
    // The product-only package keeps the deployed cloud function small.
    const tencentcloud = require('tencentcloud-sdk-nodejs-tts');
    const Client = tencentcloud.tts.v20190823.Client;
    const client = new Client({
        credential: { secretId, secretKey },
        region: region.trim() || undefined,
        profile: {
            httpProfile: {
                endpoint: TENCENT_ENDPOINT,
                reqTimeout: REQUEST_TIMEOUT_SECONDS,
            },
        },
    });
    return (request) => client.TextToVoice(request);
}
