import {
  getIcloudConfig, saveIcloudConfig, getIcloudProfile,
  testIcloud, disconnectIcloud, syncNow,
} from '../api/icloud'
import CredentialIntegrationCard from './CredentialIntegrationCard'
import { ICLOUD_GUIDE } from './SetupGuide'

/**
 * iCloud settings card. Credential-based (Apple ID + app-specific password,
 * since Apple has no OAuth for consumer iCloud). Pulls Calendar events and
 * flagged Mail into Signals over CalDAV + IMAP.
 */
export default function IcloudIntegration() {
  return (
    <CredentialIntegrationCard
      api={{
        getConfig: getIcloudConfig,
        getProfile: getIcloudProfile,
        saveConfig: ({ apple_id, app_password }) => saveIcloudConfig({ apple_id, app_password }),
        test: testIcloud,
        disconnect: disconnectIcloud,
        syncNow,
      }}
      guide={ICLOUD_GUIDE}
      infoBox={
        <>
          iCloud has no "Sign in with Apple" for apps. Connect with your Apple ID and an
          app-specific password (about 3 minutes). Calendar + flagged Mail only. The password
          is encrypted before it touches disk.
        </>
      }
      fields={[
        {
          name: 'apple_id', label: 'Apple ID', type: 'email', placeholder: 'you@icloud.com',
          hint: 'The email address you sign in to iCloud with.',
          initial: (existing) => existing?.apple_id,
        },
        {
          name: 'app_password', label: 'App-specific password', type: 'password',
          placeholder: (existing) => existing?.app_password_masked || 'abcd-efgh-ijkl-mnop',
          hint: 'Generated at appleid.apple.com, not your normal Apple password. Stored encrypted.',
        },
      ]}
      connectedTitle={(p) => p.apple_id || 'Connected'}
      connectedSubtitle={() => 'iCloud'}
      disconnectConfirm="Disconnect iCloud? Your app-specific password will be removed."
      helpText={
        <p className="text-2xs text-paper-500 dark:text-paper-600 leading-snug">
          Pulls your iCloud <strong className="font-medium">Calendar</strong> events and <strong className="font-medium">flagged Mail</strong> into
          Signals to triage. Read-only, over CalDAV and IMAP. iCloud Drive isn’t available as a backup target (Apple has no API for it).
        </p>
      }
    />
  )
}
