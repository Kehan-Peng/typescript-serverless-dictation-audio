"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.nodeHttpsTransport = exports.MiniMaxError = exports.TimeoutError = void 0;
exports.createMiniMaxClient = createMiniMaxClient;
const node_https_1 = __importDefault(require("node:https"));
const MINIMAX_ENDPOINT = 'https://api.minimax.cn/v1/t2a_v2';
const REQUEST_TIMEOUT_MS = 45000;
class TimeoutError extends Error {
    constructor() {
        super('Request timed out');
        this.name = 'TimeoutError';
    }
}
exports.TimeoutError = TimeoutError;
class MiniMaxError extends Error {
    constructor(code, traceId, upstreamStatusCode, upstreamStatusMessage) {
        super(code);
        this.code = code;
        this.traceId = traceId;
        this.upstreamStatusCode = upstreamStatusCode;
        this.upstreamStatusMessage = upstreamStatusMessage;
        this.name = 'MiniMaxError';
    }
}
exports.MiniMaxError = MiniMaxError;
const nodeHttpsTransport = (url, options) => new Promise((resolve, reject) => {
    const request = node_https_1.default.request(url, {
        method: 'POST',
        headers: options.headers,
    }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
            const rawBody = Buffer.concat(chunks).toString('utf8');
            let body = rawBody;
            try {
                body = JSON.parse(rawBody);
            }
            catch {
                // The adapter validates the non-JSON response as invalid data.
            }
            resolve({ statusCode: response.statusCode ?? 0, body });
        });
    });
    request.setTimeout(options.timeoutMs, () => request.destroy(new TimeoutError()));
    request.on('error', reject);
    request.end(options.body);
});
exports.nodeHttpsTransport = nodeHttpsTransport;
function asMiniMaxResponse(value) {
    return value !== null && typeof value === 'object' ? value : null;
}
function isPlayableUrl(value) {
    if (typeof value !== 'string')
        return false;
    try {
        return new URL(value).protocol === 'https:';
    }
    catch {
        return false;
    }
}
function createMiniMaxClient({ apiKey, transport = exports.nodeHttpsTransport, }) {
    return {
        async generate(request) {
            if (!apiKey.trim())
                throw new MiniMaxError('CONFIG_ERROR');
            const body = JSON.stringify({
                model: 'speech-2.8-hd',
                text: request.text,
                stream: false,
                output_format: 'url',
                language_boost: 'Chinese',
                voice_setting: {
                    voice_id: request.voiceId,
                    speed: request.speed,
                    vol: 1,
                    pitch: 0,
                },
                audio_setting: {
                    format: 'mp3',
                    sample_rate: 32000,
                    bitrate: 128000,
                    channel: 1,
                },
            });
            let response;
            try {
                response = await transport(MINIMAX_ENDPOINT, {
                    headers: {
                        Authorization: `Bearer ${apiKey}`,
                        'Content-Type': 'application/json',
                        'Content-Length': String(Buffer.byteLength(body)),
                    },
                    body,
                    timeoutMs: REQUEST_TIMEOUT_MS,
                });
            }
            catch (error) {
                if (error instanceof TimeoutError)
                    throw new MiniMaxError('TIMEOUT');
                throw new MiniMaxError('UPSTREAM_HTTP_ERROR');
            }
            const parsed = asMiniMaxResponse(response.body);
            const traceId = typeof parsed?.trace_id === 'string' ? parsed.trace_id : undefined;
            if (response.statusCode < 200 || response.statusCode >= 300) {
                throw new MiniMaxError('UPSTREAM_HTTP_ERROR', traceId);
            }
            if (!parsed)
                throw new MiniMaxError('INVALID_RESPONSE');
            if (parsed.base_resp?.status_code !== 0) {
                const statusCode = parsed.base_resp?.status_code;
                const statusMessage = parsed.base_resp?.status_msg;
                throw new MiniMaxError('UPSTREAM_API_ERROR', traceId, typeof statusCode === 'number' ? statusCode : undefined, typeof statusMessage === 'string' ? statusMessage : undefined);
            }
            if (!parsed.data || !isPlayableUrl(parsed.data.audio)) {
                throw new MiniMaxError('INVALID_RESPONSE', traceId);
            }
            const audioLength = parsed.extra_info?.audio_length;
            return {
                audioUrl: parsed.data.audio,
                ...(typeof audioLength === 'number' && Number.isFinite(audioLength)
                    ? { audioLengthMs: audioLength }
                    : {}),
            };
        },
    };
}
