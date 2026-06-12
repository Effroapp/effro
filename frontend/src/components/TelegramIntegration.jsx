import {
  getTelegramConfig, saveTelegramConfig, getTelegramProfile,
  testTelegram, disconnectTelegram, syncNow,
} from '../api/telegram'
import CredentialIntegrationCard from './CredentialIntegrationCard'
import { TELEGRAM_GUIDE } from './SetupGuide'

/**
 * Telegram settings card. Token-based (a bot token from @BotFather) - no
 * OAuth, so a form rather than a "Sign in" redirect. Messages sent to the bot
 * land in Signals to triage.
 */
export default function TelegramIntegration() {
  return (
    <CredentialIntegrationCard
      providerKey="telegram" providerName="Telegram" providerLogo="telegram"
      api={{
        getConfig: getTelegramConfig,
        getProfile: getTelegramProfile,
        saveConfig: saveTelegramConfig,
        test: testTelegram,
        disconnect: disconnectTelegram,
        syncNow,
      }}
      guide={TELEGRAM_GUIDE}
      infoBox={
        <>
          Connect with a bot token from <b>@BotFather</b> (takes about a minute). Effro polls
          Telegram for new messages, so nothing inbound is exposed, and only the first chat
          that messages the bot is listened to. The token is encrypted before it touches disk.
        </>
      }
      fields={[
        {
          name: 'token', label: 'Bot token', type: 'password',
          placeholder: (existing) => existing?.token_masked || '123456789:AA…',
          hint: 'From @BotFather, looks like 123456789:AA… Stored encrypted.',
        },
      ]}
      connectedTitle={(p) => (p.bot_username ? `@${p.bot_username}` : 'Connected')}
      connectedSubtitle={() => 'Telegram'}
      disconnectConfirm="Disconnect Telegram? Your bot token will be removed."
      helpText={
        <p className="text-2xs text-paper-500 dark:text-paper-600 leading-snug">
          Anything you <strong className="font-medium">message your bot</strong> lands in Signals to triage,
          checked <strong className="font-medium">every couple of minutes</strong>. Forward things to it, or jot
          thoughts on the go. Nothing is ever sent back to Telegram.
        </p>
      }
    />
  )
}
