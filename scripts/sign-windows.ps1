# Code-signing wrapper for Azure Trusted Signing.
#
# Invoked by:
#   1. tauri.conf.json's bundle.windows.signCommand (during `tauri build`) -
#      signs the loose Trace.exe before NSIS wraps it, then signs the
#      installer after NSIS produces it.
#   2. CI workflow step (.github/workflows/desktop-release.yml) - signs the
#      PyInstaller backend sidecar before it's bundled in as a resource.
#
# Reads two env vars set by the CI's "Set up Trusted Signing client" step:
#   TRUSTED_SIGNING_DLIB     - absolute path to Azure.CodeSigning.Dlib.dll
#   TRUSTED_SIGNING_METADATA - absolute path to the metadata.json with
#                              Endpoint / CodeSigningAccountName /
#                              CertificateProfileName
#
# When neither is set (local dev, forked PR, pre-Azure-setup CI), this exits
# 0 silently so the unsigned build proceeds. CI is responsible for failing
# the run if signing was supposed to happen but didn't - see the "Verify
# Authenticode signature chain" step at the end of the workflow.

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Path
)

$ErrorActionPreference = 'Stop'

if (-not $env:TRUSTED_SIGNING_DLIB -or -not $env:TRUSTED_SIGNING_METADATA) {
    Write-Host "sign-windows: TRUSTED_SIGNING_* env vars not set - skipping ($Path)"
    exit 0
}
if (-not (Test-Path -LiteralPath $env:TRUSTED_SIGNING_DLIB)) {
    throw "TRUSTED_SIGNING_DLIB not found on disk: $($env:TRUSTED_SIGNING_DLIB)"
}
if (-not (Test-Path -LiteralPath $env:TRUSTED_SIGNING_METADATA)) {
    throw "TRUSTED_SIGNING_METADATA not found on disk: $($env:TRUSTED_SIGNING_METADATA)"
}
if (-not (Test-Path -LiteralPath $Path)) {
    throw "File to sign does not exist: $Path"
}

$signtool = (Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin\*\x64\signtool.exe' -ErrorAction SilentlyContinue |
             Sort-Object FullName -Descending |
             Select-Object -First 1).FullName
if (-not $signtool) {
    throw "signtool.exe not found under Windows Kits - is the Windows SDK installed on this runner?"
}

Write-Host "sign-windows: signing $Path"
& $signtool sign `
    /v `
    /fd SHA256 `
    /tr 'http://timestamp.acs.microsoft.com' `
    /td SHA256 `
    /dlib $env:TRUSTED_SIGNING_DLIB `
    /dmdf $env:TRUSTED_SIGNING_METADATA `
    $Path
if ($LASTEXITCODE -ne 0) {
    throw "signtool sign failed (exit $LASTEXITCODE) on $Path"
}
