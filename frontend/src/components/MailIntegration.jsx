import {
  getMailConfig, saveMailConfig, getMailProfile,
  testMail, disconnectMail, syncNow,
} from '../api/mail'
import CredentialIntegrationCard from './CredentialIntegrationCard'
import { MAIL_GUIDE } from './SetupGuide'

/**
 * Mail (generic IMAP) settings card. Credential-based (host + username + app
 * password), like iCloud. Flag an email in any client and it lands in Signals.
 */
export default function MailIntegration() {
  return (
    <CredentialIntegrationCard
      providerKey="mail" providerName="Email (IMAP)" providerLogo="mail"
      api={{
        getConfig: getMailConfig,
        getProfile: getMailProfile,
        saveConfig: ({ host, username, password, port }) =>
          saveMailConfig({ host, username, password, port: port ? Number(port) : undefined }),
        test: testMail,
        disconnect: disconnectMail,
        syncNow,
      }}
      guide={MAIL_GUIDE}
      infoBox={
        <>
          Connect any mailbox over IMAP with its server address, your email address and an
          <b> app password</b> (a one-off password just for Effro). Only flagged mail is read,
          and the password is encrypted before it touches disk.
        </>
      }
      fields={[
        {
          name: 'host', label: 'IMAP server', placeholder: 'imap.fastmail.com',
          hint: 'For example imap.gmail.com or imap.fastmail.com. Microsoft mailboxes connect through the Microsoft 365 integration instead.',
          initial: (existing) => existing?.host,
        },
        {
          name: 'username', label: 'Email address', placeholder: 'you@example.com',
          initial: (existing) => existing?.username,
        },
        {
          name: 'password', label: 'App password', type: 'password',
          placeholder: (existing) => existing?.password_masked || '••••••••',
          hint: 'An app password from your mail provider, not your main sign-in. Stored encrypted.',
        },
        {
          name: 'port', label: 'Port', optional: true, placeholder: '993',
          hint: '993 unless your provider says otherwise.',
          initial: (existing) => (existing?.port ? String(existing.port) : ''),
        },
      ]}
      connectedTitle={(p) => p.username || 'Connected'}
      connectedSubtitle={(p) => p.host || 'IMAP'}
      disconnectConfirm="Disconnect this mailbox? The saved password will be removed."
      helpText={
        <p className="text-2xs text-paper-500 dark:text-paper-600 leading-snug">
          Pulls <strong className="font-medium">flagged email</strong> into Signals to triage. Flag or star a
          message in any mail app and it arrives here. Read-only, nothing in your mailbox is changed.
        </p>
      }
    />
  )
}
