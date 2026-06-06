; NSIS installer hooks for Effro.
;
; Tauri's NSIS template lets us inject custom macros at specific points in
; the installer lifecycle. We use NSIS_HOOK_PREINSTALL to kill any running
; Effro. processes BEFORE the file extract phase — this fixes the recurring
; MSVCP140.dll file-lock error that's been blocking every reinstall +
; auto-update.
;
; Without this hook, the chain of pain is:
;   1. User triggers update (or runs installer manually)
;   2. Tauri's updater kills effro.exe (Rust shell)
;   3. effro-backend.exe (PyInstaller bundle) survives as an orphan
;   4. Orphan holds MSVCP140.dll open
;   5. NSIS extract fails: "Can't write MSVCP140.dll"
;
; With this hook, both processes get force-killed before NSIS touches any
; files in the install directory. taskkill on a non-existent process
; returns non-zero — we discard the exit code with the trailing semicolons
; because NSIS macros run noisily; either result is acceptable.

!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Stopping any running Effro. processes before extract..."
  ; /F = force, /T = kill tree (children too), /IM = by image name.
  ; CRITICAL: every nsExec::Exec carries a /TIMEOUT. nsExec is synchronous and
  ; will block the entire installer forever if taskkill stalls (a process mid-
  ; teardown, a handle that won't release, a hidden prompt). A timeout means the
  ; hook can never freeze the install - worst case a process survives and the
  ; normal extract-time lock check handles it, instead of hanging on this step.
  ; On timeout nsExec pushes "timeout"; we discard it like any other result.
  ; wrap in `cmd /c ... >nul 2>&1` so no console output can fill the pipe.
  nsExec::Exec /TIMEOUT=4000 'cmd /c taskkill /F /T /IM effro-backend.exe >nul 2>&1'
  Pop $0
  nsExec::Exec /TIMEOUT=4000 'cmd /c taskkill /F /T /IM effro.exe >nul 2>&1'
  Pop $0
  ; Brief pause — gives Windows time to release file handles after the
  ; process exits. 500ms is conservative; usually it's instant.
  Sleep 500
!macroend
