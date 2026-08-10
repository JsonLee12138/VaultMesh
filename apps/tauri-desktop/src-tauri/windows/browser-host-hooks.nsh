!macro VAULTMESH_UNREGISTER_BROWSER_HOST
  DeleteRegKey HKCU "Software\Google\Chrome\NativeMessagingHosts\com.vaultmesh.browser"
  DeleteRegKey HKCU "Software\Microsoft\Edge\NativeMessagingHosts\com.vaultmesh.browser"
  DeleteRegKey HKCU "Software\Mozilla\NativeMessagingHosts\com.vaultmesh.browser"
!macroend

!macro VAULTMESH_STOP_NATIVE_HOST
  Push $0
  nsExec::Exec /TIMEOUT=10000 '"$SYSDIR\taskkill.exe" /F /IM "vaultmesh-native-host.exe"'
  Pop $0
  Pop $0
  Sleep 500
!macroend

!macro NSIS_HOOK_PREINSTALL
  SetShellVarContext current
  !insertmacro VAULTMESH_UNREGISTER_BROWSER_HOST
  !insertmacro VAULTMESH_STOP_NATIVE_HOST
!macroend

!macro NSIS_HOOK_POSTINSTALL
  SetShellVarContext current
  CreateDirectory "$APPDATA\com.vaultmesh.desktop"
  WriteRegStr HKCU "Software\Google\Chrome\NativeMessagingHosts\com.vaultmesh.browser" "" "$APPDATA\com.vaultmesh.desktop\com.vaultmesh.browser.json"
  WriteRegStr HKCU "Software\Microsoft\Edge\NativeMessagingHosts\com.vaultmesh.browser" "" "$APPDATA\com.vaultmesh.desktop\com.vaultmesh.browser.json"
  WriteRegStr HKCU "Software\Mozilla\NativeMessagingHosts\com.vaultmesh.browser" "" "$APPDATA\com.vaultmesh.desktop\com.vaultmesh.browser.firefox.json"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  SetShellVarContext current
  !insertmacro VAULTMESH_UNREGISTER_BROWSER_HOST
  !insertmacro VAULTMESH_STOP_NATIVE_HOST
  Delete "$APPDATA\com.vaultmesh.desktop\com.vaultmesh.browser.json"
  Delete "$APPDATA\com.vaultmesh.desktop\com.vaultmesh.browser.firefox.json"
  Delete "$APPDATA\com.vaultmesh.desktop\browser-host-config.json"
!macroend
