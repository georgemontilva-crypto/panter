; Al desinstalar se quitan las políticas de Windows que el programa pone mientras está en servicio,
; para que la PC no se quede sin Administrador de tareas.
!macro customUnInstall
  nsExec::Exec 'reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\System" /v DisableTaskMgr /f'
  nsExec::Exec 'reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\System" /v DisableLockWorkstation /f'
  nsExec::Exec 'reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\System" /v DisableChangePassword /f'
  nsExec::Exec 'reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v NoLogoff /f'
!macroend
