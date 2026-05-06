import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

async function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input, output })
  try {
    const answer = await rl.question(question)
    return answer.trim()
  } finally {
    rl.close()
  }
}

export const loginHandlers = (phoneNumber: string) => () => ({
  type: 'user' as const,
  getPhoneNumber: async () => phoneNumber,
  getAuthCode: async () => ask('[tg-worker] Enter Telegram auth code: '),
  getPassword: async (passwordHint: string) => {
    if (passwordHint) {
      console.log(`[tg-worker] 2FA password hint: ${passwordHint}`)
    }
    return ask('[tg-worker] Enter 2FA password (leave empty if not set): ')
  },
  getName: async () => ({
    firstName: 'TeleCRM',
    lastName: '',
  }),
})
