import {
  getGithubConfig, saveGithubConfig, getGithubProfile,
  testGithub, disconnectGithub, syncNow,
} from '../api/github'
import CredentialIntegrationCard from './CredentialIntegrationCard'
import { GITHUB_GUIDE } from './SetupGuide'

/**
 * GitHub settings card. Token-based (personal access token) - no OAuth, so a
 * form rather than a "Sign in" redirect. Pulls review requests, assignments and
 * mentions into Signals.
 */
export default function GithubIntegration() {
  return (
    <CredentialIntegrationCard
      providerKey="github" providerName="GitHub" providerLogo="github"
      api={{
        getConfig: getGithubConfig,
        getProfile: getGithubProfile,
        saveConfig: saveGithubConfig,
        test: testGithub,
        disconnect: disconnectGithub,
        syncNow,
      }}
      guide={GITHUB_GUIDE}
      infoBox={
        <>
          Connect with a GitHub personal access token (about 2 minutes). Needs the
          <b> repo</b> and <b> read:user</b> scopes. The token is encrypted before it touches disk.
        </>
      }
      fields={[
        {
          name: 'token', label: 'Personal access token', type: 'password',
          placeholder: (existing) => existing?.token_masked || 'ghp_…',
          hint: 'Classic token with the repo + read:user scopes. Stored encrypted.',
        },
      ]}
      connectedTitle={(p) => (p.login ? `@${p.login}` : 'Connected')}
      connectedSubtitle={() => 'GitHub'}
      disconnectConfirm="Disconnect GitHub? Your access token will be removed."
      helpText={
        <p className="text-2xs text-paper-500 dark:text-paper-600 leading-snug">
          Pulls PRs <strong className="font-medium">awaiting your review</strong>, issues and PRs <strong className="font-medium">assigned to you</strong>,
          and things you are <strong className="font-medium">mentioned in</strong> into Signals to triage. Read-only.
        </p>
      }
    />
  )
}
