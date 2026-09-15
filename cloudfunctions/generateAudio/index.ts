import { createGenerateAudioHandler } from './handler'
import { createMiniMaxClient } from './minimax'

const miniMaxClient = createMiniMaxClient({
  apiKey: process.env.MINIMAX_API_KEY ?? '',
})

export const main = createGenerateAudioHandler(miniMaxClient)
