Unicode true
!define MUI_ICON "${ICON_PATH}"
!define MUI_UNICON "${ICON_PATH}"
Icon "${ICON_PATH}"
UninstallIcon "${ICON_PATH}"
!include "MUI2.nsh"
!include "x64.nsh"
!include "LogicLib.nsh"
!include "WinVer.nsh"
!ifndef NSIS_PLUGIN_DIR
  !error "NSIS_PLUGIN_DIR must point to the x86-unicode plug-in directory."
!endif
!addplugindir /x86-unicode "${NSIS_PLUGIN_DIR}"
Name "Account Manager EGO ${PRODUCT_VERSION}"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\Account Manager EGO"
RequestExecutionLevel admin
CRCCheck off
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
  StrCpy $INSTDIR "$LOCALAPPDATA\Programs\Account Manager EGO"
  InitPluginsDir
  File /oname=$PLUGINSDIR\ModernInstaller.exe "${MODERN_INSTALLER_EXE}"
  File /oname=$PLUGINSDIR\Unbounded.ttf "${FONT_PATH}"

  ${IfNot} ${Silent}
    Exec '"$PLUGINSDIR\ModernInstaller.exe" "$PLUGINSDIR"'

    WaitLoop:
      Sleep 100
      IfFileExists "$PLUGINSDIR\cancel.flag" UserCancelled 0
      IfFileExists "$PLUGINSDIR\start_install.flag" UserProceed 0
      Goto WaitLoop

    UserCancelled:
      Abort "Установка отменена пользователем."

    UserProceed:
      ; Read selected install directory if custom
      ${If} ${FileExists} "$PLUGINSDIR\install_dir.txt"
        FileOpen $0 "$PLUGINSDIR\install_dir.txt" r
        FileRead $0 $1
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
  ; Forcefully terminate any running instances
  nsExec::Exec 'taskkill.exe /F /IM "Account Manager EGO.exe" /T'
  nsExec::Exec 'taskkill.exe /F /IM "codex-account-manager.exe" /T'

  ; Clean legacy shortcuts and stale installations
  Delete "$DESKTOP\codex-account-manager.lnk"
  Delete "$SMPROGRAMS\codex-account-manager.lnk"
  Delete "$SMPROGRAMS\codex-account-manager\*.lnk"
  RMDir "$SMPROGRAMS\codex-account-manager"
  ${If} ${FileExists} "$LOCALAPPDATA\Programs\codex-account-manager\*.*"
    RMDir /r "$LOCALAPPDATA\Programs\codex-account-manager"
  ${EndIf}

  ${IfNot} ${Silent}
    FileOpen $0 "$PLUGINSDIR\status.txt" w
    FileWrite $0 "20|Подготовка к распаковке файлов..."
    FileClose $0
  ${EndIf}

  Sleep 200

  ${IfNot} ${Silent}
    FileOpen $0 "$PLUGINSDIR\status.txt" w
    FileWrite $0 "35|Распаковка файлов программы..."
    FileClose $0
  ${EndIf}

  SetOutPath "$INSTDIR"
  File /r "${PAYLOAD}\*.*"
  ${If} ${Errors}
    ${IfNot} ${Silent}
      FileOpen $0 "$PLUGINSDIR\status.txt" w
      FileWrite $0 "0|Ошибка копирования файлов."
      FileClose $0
    ${EndIf}
    Abort "Ошибка копирования файлов."
  ${EndIf}

  ${IfNot} ${Silent}
    FileOpen $0 "$PLUGINSDIR\status.txt" w
    FileWrite $0 "75|Создание деинсталлятора и реестра..."
    FileClose $0
  ${EndIf}

  WriteUninstaller "$INSTDIR\Uninstall Account Manager EGO.exe"
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
    FileWrite $0 "90|Создание ярлыков..."
    FileClose $0
  ${EndIf}

  CreateDirectory "$SMPROGRAMS\Account Manager EGO"
  CreateShortcut "$SMPROGRAMS\Account Manager EGO\Account Manager EGO.lnk" "$INSTDIR\Account Manager EGO.exe"

  ; Check desktop shortcut flag
  IfFileExists "$PLUGINSDIR\desktop_shortcut.txt" 0 DoneDesktopShortcut
  FileOpen $0 "$PLUGINSDIR\desktop_shortcut.txt" r
  FileRead $0 $1
  FileClose $0
  ${If} $1 == "1"
    CreateShortcut "$DESKTOP\Account Manager EGO.lnk" "$INSTDIR\Account Manager EGO.exe"
  ${EndIf}
DoneDesktopShortcut:

  ; Purge Windows shell icon cache so icon renders everywhere immediately
  nsExec::Exec '"ie4uinit.exe" -show'

  ${IfNot} ${Silent}
    FileOpen $0 "$PLUGINSDIR\status.txt" w
    FileWrite $0 "100|DONE"
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
  nsExec::Exec 'taskkill.exe /F /IM "Account Manager EGO.exe" /T'
  nsExec::Exec 'taskkill.exe /F /IM "codex-account-manager.exe" /T'

  Delete "$SMPROGRAMS\Account Manager EGO\Account Manager EGO.lnk"
  RMDir "$SMPROGRAMS\Account Manager EGO"
  Delete "$DESKTOP\Account Manager EGO.lnk"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AccountManagerEGO"

  RMDir /r "$INSTDIR"
SectionEnd
