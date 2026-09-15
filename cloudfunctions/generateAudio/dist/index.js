"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = void 0;
const handler_1 = require("./handler");
const minimax_1 = require("./minimax");
const miniMaxClient = (0, minimax_1.createMiniMaxClient)({
    apiKey: process.env.MINIMAX_API_KEY ?? '',
});
exports.main = (0, handler_1.createGenerateAudioHandler)(miniMaxClient);
