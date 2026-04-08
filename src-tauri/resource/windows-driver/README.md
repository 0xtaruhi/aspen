Windows packaging drops the generated `aspen-driver-installer.exe` into this directory
before `tauri build` runs. The helper uses libwdi to stage and install the Aspen
WinUSB driver package during the NSIS installer flow.
