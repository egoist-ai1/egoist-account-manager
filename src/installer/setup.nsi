Unicode true
!define MUI_ICON "${ICON_PATH}"
!define MUI_UNICON "${ICON_PATH}"
Icon "${ICON_PATH}"
UninstallIcon "${ICON_PATH}"
!include "MUI2.nsh"
!include "x64.nsh"
!include "LogicLib.nsh"
!include "WinVer.nsh"
!include "FileFunc.nsh"
Var IsTestInstall
Var HasExplicitInstallDir
Var DesktopShortcut
!ifndef NSIS_PLUGIN_DIR
  !error "NSIS_PLUGIN_DIR must point to the x86-unicode plug-in directory."
!endif
!addplugindir /x86-unicode "${NSIS_PLUGIN_DIR}"
Name "Квессер ${PRODUCT_VERSION}"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\Kvesser"
InstallDirRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AccountManagerEGO" "InstallLocation"
RequestExecutionLevel user
CRCCheck on
SetCompressor /SOLID lzma
VIProductVersion "${NUMERIC_VERSION}"
VIAddVersionKey "ProductName" "Квессер"
VIAddVersionKey "FileDescription" "Квессер — установка"
VIAddVersionKey "FileVersion" "${PRODUCT_VERSION}"
VIAddVersionKey "ProductVersion" "${PRODUCT_VERSION}"
VIAddVersionKey "LegalCopyright" "Egoist Gorbachev"
AutoCloseWindow true
ShowInstDetails nevershow
!define MUI_CUSTOMFUNCTION_GUIINIT HideNsisWindow
!define MUI_PAGE_CUSTOMFUNCTION_PRE HideNsisWindow
!define MUI_PAGE_CUSTOMFUNCTION_SHOW HideNsisWindow
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Russian"

Function HideNsisWindow
  ${IfNot} ${Silent}
    ShowWindow $HWNDPARENT 0
    System::Call "user32::SetWindowPos(i $HWNDPARENT, i 0, i -32000, i -32000, i 0, i 0, i 0x0080)"
  ${EndIf}
FunctionEnd

!macro Status Percent Message
  ${IfNot} ${Silent}
    FileOpen $0 "$PLUGINSDIR\status.txt" w
    FileWriteUTF16LE /BOM $0 "${Percent}|${Message}"
    FileClose $0
  ${EndIf}
!macroend

; NSIS GetFullPathName can return empty for a path that does not exist yet.
; Win32 normalization supports fresh install directories without creating them.
Function NormalizeInstallPath
  Exch $5
  Push $6
  Push $7
  System::Call 'kernel32::GetFullPathNameW(w r5, i ${NSIS_MAX_STRLEN}, w .r6, p 0) i .r7'
  ${If} $7 == 0
  ${OrIf} $7 >= ${NSIS_MAX_STRLEN}
    SetErrorLevel 3
    Abort "Не удалось проверить путь установки."
  ${EndIf}
  StrCpy $5 $6
  Pop $7
  Pop $6
  Exch $5
FunctionEnd

Function .onInit
  ${IfNot} ${RunningX64}
    SetErrorLevel 3
    Abort "Эта сборка требует Windows x64."
  ${EndIf}
  ${IfNot} ${AtLeastWin10}
    SetErrorLevel 3
    Abort "Требуется Windows 10 или Windows 11."
  ${EndIf}
  SetRegView 64
  SetShellVarContext current
  StrCpy $IsTestInstall 0
  StrCpy $DesktopShortcut 0
  ${GetParameters} $R0
  ; NSIS removes its built-in /D= from $CMDLINE before .onInit.
  ; Preserve the already selected $INSTDIR; only absent /D= permits registry fallback.
  StrCpy $HasExplicitInstallDir 0
  System::Call 'kernel32::GetCommandLineW() w .r4'
  ClearErrors
  ${GetOptionsS} $4 "/D=" $R1
  ${IfNot} ${Errors}
    StrCpy $HasExplicitInstallDir 1
    Push "$R1"
    Call NormalizeInstallPath
    Pop $R2
    Push "$INSTDIR"
    Call NormalizeInstallPath
    Pop $R3
    ${If} $R1 == ""
    ${OrIf} $R2 != $R3
      SetErrorLevel 3
      Abort "Параметр /D= должен быть последним, с абсолютным путём без кавычек."
    ${EndIf}
  ${EndIf}
  ${If} $HasExplicitInstallDir == 0
    ReadRegStr $R2 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AccountManagerEGO" "InstallLocation"
    ${If} $R2 != ""
      StrCpy $INSTDIR $R2
    ${EndIf}
  ${EndIf}
  ClearErrors
  ${GetOptions} $R0 "/TEST" $R1
  ${IfNot} ${Errors}
    StrCpy $IsTestInstall 1
    ${If} $HasExplicitInstallDir != 1
      SetErrorLevel 3
      Abort "/TEST требует явно указанную отдельную папку /D=."
    ${EndIf}
    ${IfNot} ${Silent}
      SetErrorLevel 3
      Abort "/TEST требует /S и отдельную папку /D=."
    ${EndIf}
    Push "$INSTDIR"
    Call NormalizeInstallPath
    Pop $R2
    Push "$LOCALAPPDATA\Programs\Kvesser"
    Call NormalizeInstallPath
    Pop $R3
    ${If} $R2 == $R3
      SetErrorLevel 3
      Abort "/TEST запрещён для основной папки установки."
    ${EndIf}
    Push "$LOCALAPPDATA\Programs\Egoist"
    Call NormalizeInstallPath
    Pop $R3
    ${If} $R2 == $R3
      SetErrorLevel 3
      Abort "/TEST запрещён для прежней основной папки установки."
    ${EndIf}
    Push "$LOCALAPPDATA\Programs\Account Manager EGO"
    Call NormalizeInstallPath
    Pop $R3
    ${If} $R2 == $R3
      SetErrorLevel 3
      Abort "/TEST запрещён для существующей основной папки установки."
    ${EndIf}
  ${EndIf}
  InitPluginsDir
  File /oname=$PLUGINSDIR\ModernInstaller.exe "${MODERN_INSTALLER_EXE}"
  File /oname=$PLUGINSDIR\Unbounded.ttf "${FONT_PATH}"
  ${If} ${Silent}
  nsExec::ExecToLog /TIMEOUT=15000 '"$PLUGINSDIR\ModernInstaller.exe" --validate-install "$INSTDIR" "$IsTestInstall"'
  Pop $0
  ${If} $0 != 0
    SetErrorLevel 3
    Abort "Папка установки не прошла проверку принадлежности и безопасности."
  ${EndIf}
  ${EndIf}

  ${IfNot} ${Silent}
    ClearErrors
    System::Call 'kernel32::GetCurrentProcessId() i .r4'
    Exec '"$PLUGINSDIR\ModernInstaller.exe" "$PLUGINSDIR" "$4" "$INSTDIR"'
    IfErrors UiFailed
    StrCpy $3 0
    WaitLoop:
      Sleep 100
      IfFileExists "$PLUGINSDIR\ui_error.flag" UiFailed 0
      IfFileExists "$PLUGINSDIR\cancel.flag" UserCancelled 0
      IfFileExists "$PLUGINSDIR\start_install.flag" UserProceed 0
      IntOp $3 $3 + 1
      IfFileExists "$PLUGINSDIR\ui_heartbeat.flag" 0 CheckUiTimeout
        Delete "$PLUGINSDIR\ui_heartbeat.flag"
        StrCpy $3 0
      CheckUiTimeout:
      ${If} $3 > 150
        Goto UiFailed
      ${EndIf}
      Goto WaitLoop
    UiFailed:
      SetErrorLevel 1
      MessageBox MB_OK|MB_ICONSTOP "Не удалось запустить окно установки. Файлы программы не изменены."
      Abort
    UserCancelled:
      SetErrorLevel 1
      Abort "Установка отменена пользователем."
    UserProceed:
      Call ReadUiParameters
  ${EndIf}
FunctionEnd

Function ReadUiParameters
  StrCpy $DesktopShortcut 0
      ${If} ${FileExists} "$PLUGINSDIR\install_dir.txt"
        FileOpen $0 "$PLUGINSDIR\install_dir.txt" r
        FileReadUTF16LE $0 $1
        FileClose $0
        ${If} $1 != ""
          StrCpy $INSTDIR $1
        ${EndIf}
      ${EndIf}
      ${If} ${FileExists} "$PLUGINSDIR\desktop_shortcut.txt"
        FileOpen $0 "$PLUGINSDIR\desktop_shortcut.txt" r
        FileReadUTF16LE $0 $1
        FileClose $0
        ${If} $1 == "1"
          StrCpy $DesktopShortcut 1
        ${EndIf}
      ${EndIf}
FunctionEnd

Function AwaitUiRetry
  ${If} ${Silent}
    Abort
  ${EndIf}
  StrCpy $3 0
  RetryWait:
    Sleep 100
    IfFileExists "$PLUGINSDIR\cancel.flag" RetryCancelled 0
    IfFileExists "$PLUGINSDIR\ui_error.flag" RetryUiFailed 0
    IfFileExists "$PLUGINSDIR\start_install.flag" RetryRequested 0
    IntOp $3 $3 + 1
    IfFileExists "$PLUGINSDIR\ui_heartbeat.flag" 0 RetryTimeout
      Delete "$PLUGINSDIR\ui_heartbeat.flag"
      StrCpy $3 0
    RetryTimeout:
    ${If} $3 > 150
      Goto RetryUiFailed
    ${EndIf}
    Goto RetryWait
  RetryRequested:
    Call ReadUiParameters
    Return
  RetryCancelled:
    SetErrorLevel 1
    Abort
  RetryUiFailed:
    SetErrorLevel 1
    MessageBox MB_OK|MB_ICONSTOP "Окно установки перестало отвечать. Записанные файлы и материалы восстановления сохранены."
    Abort
FunctionEnd

Section "Kvesser"
RetryInstall:
  Delete "$PLUGINSDIR\start_install.flag"
  nsExec::Exec /TIMEOUT=15000 '"$PLUGINSDIR\ModernInstaller.exe" --check-running "$INSTDIR"'
  Pop $0
  ${If} $0 != 0
    !insertmacro Status 0 "ERROR:Закройте Квессер перед установкой. IDE можно оставить открытой."
    SetErrorLevel 2
    Call AwaitUiRetry
    Goto RetryInstall
  ${EndIf}
  nsExec::ExecToLog /TIMEOUT=15000 '"$PLUGINSDIR\ModernInstaller.exe" --validate-install "$INSTDIR" "$IsTestInstall"'
  Pop $0
  ${If} $0 != 0
    !insertmacro Status 0 "ERROR:Папка установки не прошла проверку. Выберите новую папку или существующую установку Квессер."
    SetErrorLevel 3
    Call AwaitUiRetry
    Goto RetryInstall
  ${EndIf}
  !insertmacro Status 20 "Подготовка и проверка файлов..."
  ClearErrors
  SetOutPath "$PLUGINSDIR\payload"
  File /r "${PAYLOAD}\*.*"
  SetOutPath "$PLUGINSDIR"
  File /oname=payload-ownership.json "${OWNERSHIP_MANIFEST}"
  WriteUninstaller "$PLUGINSDIR\Uninstall Kvesser.exe"
  ${If} ${Errors}
    !insertmacro Status 0 "ERROR:Ошибка подготовки файлов. Файлы программы не изменены."
    SetErrorLevel 1
    Call AwaitUiRetry
    Goto RetryInstall
  ${EndIf}
  !insertmacro Status 35 "Установка проверенных файлов программы..."
  nsExec::ExecToLog '"$PLUGINSDIR\ModernInstaller.exe" --install-owned "$PLUGINSDIR\payload" "$PLUGINSDIR\payload-ownership.json" "$INSTDIR" "$PLUGINSDIR\Uninstall Kvesser.exe" "$IsTestInstall"'
  Pop $0
  ${If} $0 != 0
    !insertmacro Status 0 "ERROR:Установка прервана: конфликт файла или ошибка проверки. Неизвестные файлы сохранены."
    SetErrorLevel 3
    Call AwaitUiRetry
    Goto RetryInstall
  ${EndIf}
  ${If} $IsTestInstall == 1
    Goto DoneIntegration
  ${EndIf}
  !insertmacro Status 85 "Создание ярлыков и записи удаления..."
  nsExec::ExecToLog /TIMEOUT=15000 '"$PLUGINSDIR\ModernInstaller.exe" --integrate "$INSTDIR" "${PRODUCT_VERSION}" "$DesktopShortcut"'
  Pop $0
  ${If} $0 != 0
    !insertmacro Status 0 "ERROR:Файлы Квессер установлены, но ярлык или запись установки конфликтует с другой программой."
    SetErrorLevel 3
    Call AwaitUiRetry
    Goto RetryInstall
  ${EndIf}
DoneIntegration:
  SetErrorLevel 0
  !insertmacro Status 100 "DONE"
  ${IfNot} ${Silent}
    StrCpy $2 0
    WaitFinish:
      Sleep 100
      IntOp $2 $2 + 1
      ${If} $2 > 600
        Goto DoneFinish
      ${EndIf}
      IfFileExists "$PLUGINSDIR\finished.flag" DoneFinish 0
      IfFileExists "$PLUGINSDIR\cancel.flag" DoneFinish 0
      Goto WaitFinish
    DoneFinish:
  ${EndIf}
SectionEnd

Section "Uninstall"
  SetRegView 64
  SetShellVarContext current
  InitPluginsDir
  File /oname=$PLUGINSDIR\ModernInstaller.exe "${MODERN_INSTALLER_EXE}"
  nsExec::Exec /TIMEOUT=15000 '"$PLUGINSDIR\ModernInstaller.exe" --check-running "$INSTDIR"'
  Pop $0
  ${If} $0 != 0
    SetErrorLevel 2
    ${IfNot} ${Silent}
      MessageBox MB_OK|MB_ICONSTOP "Закройте Квессер перед удалением. IDE можно оставить открытой."
    ${EndIf}
    Abort "Не удалось безопасно проверить работающий менеджер."
  ${EndIf}
  nsExec::ExecToLog '"$PLUGINSDIR\ModernInstaller.exe" --uninstall-owned "$INSTDIR"'
  Pop $0
  ${If} $0 == 10
    SetErrorLevel 10
    ${IfNot} ${Silent}
      MessageBox MB_OK|MB_ICONINFORMATION "Квессер удалён. Изменённые и посторонние файлы сохранены в папке установки."
    ${EndIf}
  ${ElseIf} $0 != 0
    SetErrorLevel 3
    ${IfNot} ${Silent}
      MessageBox MB_OK|MB_ICONSTOP "Удаление прервано: manifest или папка не прошли проверку. Неизвестные файлы сохранены."
    ${EndIf}
    Abort "Не удалось безопасно удалить файлы установки."
  ${EndIf}
SectionEnd