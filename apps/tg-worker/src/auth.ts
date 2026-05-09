import readline from 'node:readline/promises'
import { stdin, stdout } from 'node:process'

const rl = readline.createInterface({ input: stdin, output: stdout })

async function ask(question: string): Promise<string> {
  const answer = await rl.question(question)
  return answer.trim()
}

export function closeReadline() {
  rl.close()
}

export const loginHandlers = (phoneNumber: string) => () => ({
  type: 'user' as const,
  getPhoneNumber: async () => phoneNumber,
  getAuthCode: async () => ask('[tg-worker] Enter Telegram auth code: '),
  getPassword: async (passwordHint: string) => {
    if (passwordHint) {
      console.log(`[tg-worker] 2FA hint: ${passwordHint}`)
    }
    return ask('[tg-worker] Enter 2FA password (leave empty if none): ')
  },
  getName: async () => ({ firstName: 'TeleCRM', lastName: '' }),
})
