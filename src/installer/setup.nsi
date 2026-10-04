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
!ifndef NSIS_PLUGIN_DIR
  !error "NSIS_PLUGIN_DIR must point to the x86-unicode plug-in directory."
!endif
!addplugindir /x86-unicode "${NSIS_PLUGIN_DIR}"
Name "Account Manager EGO ${PRODUCT_VERSION}"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\Account Manager EGO"
RequestExecutionLevel user
CRCCheck on
SetCompressor /SOLID lzma
VIProductVersion "${PRODUCT_VERSION}.0"
VIAddVersionKey "ProductName" "Account Manager EGO"
VIAddVersionKey "FileDescription" "Account Manager EGO Setup"
VIAddVersionKey "FileVersion" "${PRODUCT_VERSION}.0"
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

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "Эта сборка требует Windows x64."
    Abort
  ${EndIf}
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_ICONSTOP "Требуется Windows 10 или Windows 11."
    Abort
  ${EndIf}
  SetRegView 64
  SetShellVarContext current
  StrCpy $IsTestInstall 0
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/TEST" $R1
  ${IfNot} ${Errors}
    StrCpy $IsTestInstall 1
    ${IfNot} ${Silent}
      SetErrorLevel 3
      Abort "/TEST требует /S и отдельную пустую папку /D=."
    ${EndIf}
    GetFullPathName $R2 "$INSTDIR"
    GetFullPathName $R3 "$LOCALAPPDATA\Programs\Account Manager EGO"
    ${If} $R2 == $R3
      SetErrorLevel 3
      Abort "/TEST запрещён для основной папки установки. Укажите отдельную /D=."
    ${EndIf}
    IfFileExists "$INSTDIR\*.*" 0 TestDirectoryReady
      SetErrorLevel 3
      Abort "/TEST требует пустую папку установки."
    TestDirectoryReady:
    ClearErrors
  ${EndIf}
  InitPluginsDir
  File /oname=$PLUGINSDIR\ModernInstaller.exe "${MODERN_INSTALLER_EXE}"
  File /oname=$PLUGINSDIR\Unbounded.ttf "${FONT_PATH}"

  ${IfNot} ${Silent}
    ClearErrors
    System::Call 'kernel32::GetCurrentProcessId() i .r4'
    Exec '"$PLUGINSDIR\ModernInstaller.exe" "$PLUGINSDIR" "$4"'
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
      Abort "Установка отменена пользователем."

    UserProceed:
      ; Read selected install directory if custom
      ${If} ${FileExists} "$PLUGINSDIR\install_dir.txt"
        FileOpen $0 "$PLUGINSDIR\install_dir.txt" r
        FileReadUTF16LE $0 $1
        FileClose $0
        ; Strip newlines and spaces
        LoopTrailingTrim:
          StrCpy $2 $1 1 -1
          ${If} $2 == "$\r"
          ${OrIf} $2 == "$\n"
          ${OrIf} $2 == " "
            StrCpy $1 $1 -1
            Goto LoopTrailingTrim
          ${EndIf}
        LoopLeadingTrim:
          StrCpy $2 $1 1 0
          ${If} $2 == "$\r"
          ${OrIf} $2 == "$\n"
          ${OrIf} $2 == " "
            StrCpy $1 $1 "" 1
            Goto LoopLeadingTrim
          ${EndIf}
        ${If} $1 != ""
          StrCpy $INSTDIR $1
        ${EndIf}
      ${EndIf}
  ${EndIf}
FunctionEnd

Section "Account Manager EGO"
  nsExec::Exec /TIMEOUT=15000 '"$PLUGINSDIR\ModernInstaller.exe" --check-running "$INSTDIR"'
  Pop $0
  ${If} $0 != 0
    SetErrorLevel 2
    ${IfNot} ${Silent}
      FileOpen $0 "$PLUGINSDIR\status.txt" w
      FileWriteUTF16LE /BOM $0 "0|ERROR:Закройте Account Manager EGO перед установкой. Codex можно оставить открытым."
      FileClose $0
      MessageBox MB_OK|MB_ICONSTOP "Закройте Account Manager EGO перед установкой."
    ${EndIf}
    Abort "Не удалось безопасно проверить работающий менеджер."
  ${EndIf}

  ${IfNot} ${Silent}
    FileOpen $0 "$PLUGINSDIR\status.txt" w
    FileWriteUTF16LE /BOM $0 "20|Подготовка к распаковке файлов..."
    FileClose $0
  ${EndIf}

  Sleep 200

  ${IfNot} ${Silent}
    FileOpen $0 "$PLUGINSDIR\status.txt" w
    FileWriteUTF16LE /BOM $0 "35|Распаковка файлов программы..."
    FileClose $0
  ${EndIf}

  ClearErrors
  SetOutPath "$INSTDIR"
  File /r "${PAYLOAD}\*.*"
  ${If} ${Errors}
    ${IfNot} ${Silent}
      FileOpen $0 "$PLUGINSDIR\status.txt" w
      FileWriteUTF16LE /BOM $0 "0|ERROR:Ошибка копирования файлов."
      FileClose $0
    ${EndIf}
    SetErrorLevel 1
    Abort "Ошибка копирования файлов."
  ${EndIf}

  ${IfNot} ${Silent}
    FileOpen $0 "$PLUGINSDIR\status.txt" w
    FileWriteUTF16LE /BOM $0 "75|Создание деинсталлятора и реестра..."
    FileClose $0
  ${EndIf}

  WriteUninstaller "$INSTDIR\Uninstall Account Manager EGO.exe"
  ${If} $IsTestInstall == 1
    ClearErrors
    FileOpen $0 "$INSTDIR\installer-test.flag" w
    FileWrite $0 "isolated-test-install"
    FileClose $0
    ${If} ${Errors}
      SetErrorLevel 1
      Abort "Не удалось сохранить маркер тестовой установки."
    ${EndIf}
    Goto DoneIntegration
  ${EndIf}
  Delete "$INSTDIR\installer-test.flag"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AccountManagerEGO" "DisplayName" "Account Manager EGO"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AccountManagerEGO" "DisplayVersion" "${PRODUCT_VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AccountManagerEGO" "Publisher" "Egoist Gorbachev"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AccountManagerEGO" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AccountManagerEGO" "DisplayIcon" "$INSTDIR\Account Manager EGO.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AccountManagerEGO" "UninstallString" '"$INSTDIR\Uninstall Account Manager EGO.exe"'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AccountManagerEGO" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AccountManagerEGO" "NoRepair" 1

  ${IfNot} ${Silent}
    FileOpen $0 "$PLUGINSDIR\status.txt" w
    FileWriteUTF16LE /BOM $0 "90|Создание ярлыков..."
    FileClose $0
  ${EndIf}

  CreateDirectory "$SMPROGRAMS\Account Manager EGO"
  CreateShortcut "$SMPROGRAMS\Account Manager EGO\Account Manager EGO.lnk" "$INSTDIR\Account Manager EGO.exe"

  ; Check desktop shortcut flag
  IfFileExists "$PLUGINSDIR\desktop_shortcut.txt" 0 DoneDesktopShortcut
  FileOpen $0 "$PLUGINSDIR\desktop_shortcut.txt" r
  FileReadUTF16LE $0 $1
  FileClose $0
  ${If} $1 == "1"
    CreateShortcut "$DESKTOP\Account Manager EGO.lnk" "$INSTDIR\Account Manager EGO.exe"
  ${EndIf}
DoneDesktopShortcut:

  ; Purge Windows shell icon cache so icon renders everywhere immediately
  nsExec::Exec '"ie4uinit.exe" -show'
  Pop $0

DoneIntegration:
  ${IfNot} ${Silent}
    FileOpen $0 "$PLUGINSDIR\status.txt" w
    FileWriteUTF16LE /BOM $0 "100|DONE"
    FileClose $0

    ; Wait for ModernInstaller to finish/close
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
      FileOpen $0 "$PLUGINSDIR\status.txt" w
      FileWriteUTF16LE /BOM $0 "0|ERROR:Закройте Account Manager EGO перед удалением. Codex можно оставить открытым."
      FileClose $0
      MessageBox MB_OK|MB_ICONSTOP "Закройте Account Manager EGO перед удалением."
    ${EndIf}
    Abort "Не удалось безопасно проверить работающий менеджер."
  ${EndIf}


  IfFileExists "$INSTDIR\installer-test.flag" UninstallFilesOnly 0
  Delete "$SMPROGRAMS\Account Manager EGO\Account Manager EGO.lnk"
  RMDir "$SMPROGRAMS\Account Manager EGO"
  Delete "$DESKTOP\Account Manager EGO.lnk"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AccountManagerEGO"

UninstallFilesOnly:
  RMDir /r "$INSTDIR"
SectionEnd
