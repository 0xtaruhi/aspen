!macro NSIS_HOOK_POSTINSTALL
  IfFileExists "$INSTDIR\resources\windows-driver\aspen-driver-installer.exe" 0 +5
    DetailPrint "Installing Aspen WinUSB driver package..."
    nsExec::ExecToLog '"$INSTDIR\resources\windows-driver\aspen-driver-installer.exe" --install --quiet'
    Pop $0
    DetailPrint "Aspen USB driver helper exit code: $0"
!macroend
