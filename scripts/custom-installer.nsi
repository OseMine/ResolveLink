!include LogicLib.nsh
!include nsDialogs.nsh
!include Sections.nsh

; ============================================================
; Section Names (matching electron-builder extraResources)
; ============================================================
!define SEC_CEP "extensions/cep"
!define SEC_REAPER_SCRIPTS "reaper-scripts"
!define SEC_ABLETON "extensions/native/ableton"
!define SEC_REAPER_NATIVE "extensions/native/reaper"
!define SEC_RESOLVE_SCRIPTS "resolve-scripts"

; ============================================================
; Enable components page (standard NSIS components page)
; This adds a tree-view component selection page
; ============================================================

!define MUI_PAGE_CUSTOMFUNCTION_PRE ComponentsPagePre

Function ComponentsPagePre
  ; Set section descriptions for the components page
  !insertmacro MUI_COMPONENT_DESCRIPTION ${SEC_CEP} "After Effects CEP Extension - Panel for After Effects integration"
  !insertmacro MUI_COMPONENT_DESCRIPTION ${SEC_REAPER_SCRIPTS} "REAPER Lua Scripts - Scripts for REAPER integration"
  !insertmacro MUI_COMPONENT_DESCRIPTION ${SEC_ABLETON} "Ableton Live Native Plugin (requires Ableton Live)"
  !insertmacro MUI_COMPONENT_DESCRIPTION ${SEC_REAPER_NATIVE} "REAPER Native Plugin (requires REAPER)"
  !insertmacro MUI_COMPONENT_DESCRIPTION ${SEC_RESOLVE_SCRIPTS} "DaVinci Resolve Scripts (Lua/Python)"
FunctionEnd

; ============================================================
; Section Names (matching electron-builder extraResources)
; ============================================================
!define SEC_CEP "extensions/cep"
!define SEC_REAPER_SCRIPTS "reaper-scripts"
!define SEC_ABLETON "extensions/native/ableton"
!define SEC_REAPER_NATIVE "extensions/native/reaper"
!define SEC_RESOLVE_SCRIPTS "resolve-scripts"

; ============================================================
; Set default section states (checked/unchecked)
; ============================================================

Function .onInit
  ; Core is always installed (required)
  !insertmacro SelectSection "Core"
  
  ; Default checked: CEP, REAPER Scripts, Resolve Scripts
  !insertmacro SelectSection "extensions/cep"
  !insertmacro SelectSection "reaper-scripts"
  !insertmacro SelectSection "resolve-scripts"
  
  ; Default unchecked: Native plugins (require host apps)
  !insertmacro UnselectSection "extensions/native/ableton"
  !insertmacro UnselectSection "extensions/native/reaper"
FunctionEnd

; ============================================================
; Section Names
; ============================================================
!define SEC_CEP "extensions/cep"
!define SEC_REAPER_SCRIPTS "reaper-scripts"
!define SEC_ABLETON "extensions/native/ableton"
!define SEC_REAPER_NATIVE "extensions/native/reaper"
!define SEC_RESOLVE_SCRIPTS "resolve-scripts"