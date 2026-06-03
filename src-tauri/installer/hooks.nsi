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
  ; Suppress output so the installer log stays readable.
  nsExec::Exec 'taskkill /F /T /IM effro-backend.exe'
  Pop $0
  nsExec::Exec 'taskkill /F /T /IM effro.exe'
  Pop $0
  ; Also kill any leftover Trace-era processes, so users upgrading from a
  ; pre-rename install don't hit a file lock during the migration install.
  nsExec::Exec 'taskkill /F /T /IM trace-backend.exe'
  Pop $0
  nsExec::Exec 'taskkill /F /T /IM trace.exe'
  Pop $0
  ; Brief pause — gives Windows time to release file handles after the
  ; process exits. 500ms is conservative; usually it's instant.
  Sleep 500
!macroend
