# Panter Bloqueo

Programa de Windows que va instalado en cada PC de la arena. Mantiene la PC bloqueada hasta que un cliente
la activa con su saldo (desde su perfil o en caja), muestra el contador mientras juega y vuelve a bloquear
cuando se acaba el tiempo.

## Qué hace

| Estado | Qué se ve en la PC |
| --- | --- |
| Bloqueada | Pantalla completa con el número de la PC, un código de 4 dígitos y un QR para activarla |
| Activa | Escritorio libre y un contador pequeño arriba a la derecha |
| Tiempo extra | Aviso grande: "Se acabó tu tiempo. Guarda tu partida", con los minutos de gracia |
| Mantenimiento | Escritorio libre para el personal (se activa desde Caja → Ajustes) |
| Sin conexión | Si había una sesión, sigue contando y bloquea a su hora. Si no, queda bloqueada |

## Descargar el instalador

Cada cambio en esta carpeta se compila solo en GitHub y queda publicado en
[Releases](https://github.com/georgemontilva-crypto/panter/releases). Descarga el archivo
`Panter-Bloqueo-Setup-X.Y.Z.exe` más reciente y ábrelo en la PC.

Windows avisa que no reconoce el programa porque no está firmado: pulsa **Más información → Ejecutar de todas formas**.

Para compilarlo tú mismo (opcional), con Node.js 20 o más nuevo, en PowerShell dentro del repo:

```powershell
cd agente-pc
& "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /optimize+ /target:exe /out:keyblock.exe keyblock.cs
npm install
npm run dist
```

La segunda línea compila `keyblock.exe` (el guardia de teclado) con el compilador que ya trae Windows.

Para probarlo sin instalar:

```powershell
cd agente-pc
npm install
npm start
```

## Instalar en cada PC

1. En la web: **Caja → Ajustes → Estaciones**. Crea la PC con su número y pulsa **Generar credencial**. Copia el texto que empieza por `pc_`.
2. En la PC, ejecuta el instalador. Se abre una ventana normal (se puede minimizar, mover y cerrar) que pide tres datos:
   - **Dirección de la web:** por ejemplo `https://tu-dominio.com`
   - **Credencial de la PC:** la que copiaste (una distinta por máquina)
   - **Clave de mantenimiento:** la que usará el personal para cerrar el programa
3. Pulsa **Conectar**. Desde ese momento la PC queda bloqueada a pantalla completa mostrando su número, y el programa arranca solo al iniciar sesión en Windows.

Mientras la PC no esté conectada, el programa no bloquea nada: si cierras esa ventana, el programa se cierra.

## Que la PC encienda ya bloqueada

El programa arranca solo cuando se inicia sesión en Windows y bloquea de inmediato. Para que eso pase
apenas se enciende la PC, sin que nadie escriba una contraseña, activa el inicio de sesión automático
de la cuenta de los clientes:

1. Pulsa `Windows + R`, escribe `netplwiz` y pulsa Enter.
2. Elige la cuenta que usan los clientes.
3. Desmarca **Los usuarios deben escribir su nombre y contraseña para usar el equipo** y pulsa **Aceptar**.
4. Escribe la contraseña de esa cuenta dos veces (déjala vacía si no tiene) y pulsa **Aceptar**.

Si esa casilla no aparece: Configuración → Cuentas → Opciones de inicio de sesión → apaga
**Permitir solo el inicio de sesión de Windows Hello para cuentas de Microsoft** y vuelve a abrir `netplwiz`.

Al reiniciar, Windows entra solo a esa cuenta y en pocos segundos aparece la pantalla de bloqueo.

## Mantenimiento

- **Desbloquear una PC sin cobrar** (instalar juegos, actualizar): Caja → Ajustes → Estaciones → *Desbloquear 30 min*.
- **Cerrar el programa en la PC:** en la pantalla de bloqueo pulsa el botón **Mantenimiento** (abajo a la derecha) o `Ctrl + Mayús + M`, y escribe la clave de mantenimiento.
- **Cambiar la credencial o la dirección:** **Mantenimiento** → *Volver a configurar*.
- **Desinstalar:** Configuración de Windows → Aplicaciones → Panter Bloqueo → Desinstalar.

## Qué bloquea y qué no

Con la PC bloqueada, el programa:

- Cubre toda la pantalla (y cualquier monitor adicional) y se mantiene encima de todo.
- **Descarta la tecla Windows, Alt+Tab, Alt+Esc, Alt+F4, Alt+Espacio, Ctrl+Esc y Ctrl+Mayús+Esc.** Lo hace `keyblock.exe`, un ayudante que se instala junto al programa.
- **Quita el Administrador de tareas** y deja la pantalla de `Ctrl + Alt + Supr` sin "Bloquear", "Cerrar sesión" ni "Cambiar contraseña".

Mientras un cliente juega, el teclado funciona normal (necesita la tecla Windows y Alt+Tab para sus juegos), pero el Administrador de tareas sigue quitado para que no pueda cerrar el programa.

Lo que **ningún programa puede impedir**:

- Que `Ctrl + Alt + Supr` muestre su pantalla. Queda casi vacía: solo sirve para cancelar o para apagar/reiniciar.
- Que apaguen o reinicien la PC (botón físico o esa pantalla). Al encender, vuelve a arrancar bloqueada.

La única salida es el botón **Mantenimiento** con la clave del personal.

### Cómo saber si el teclado está protegido

Abajo en la pantalla de bloqueo hay una línea para el personal: `Panter Bloqueo 0.2.2, teclado protegido`.
Si dice `teclado SIN proteger`, entre paréntesis sale el motivo. El más común es que el antivirus haya
borrado `keyblock.exe`: agrégalo a las exclusiones de Seguridad de Windows y reinstala el programa.
El panel de la web (Caja → Ajustes → Estaciones) también avisa "Teclado sin proteger" en esa PC.

Si aun así quieres anular la tecla Windows por completo en una PC (también mientras juegan), abre
PowerShell **como administrador**, pega esto y reinicia:

```powershell
reg add "HKLM\SYSTEM\CurrentControlSet\Control\Keyboard Layout" /v "Scancode Map" /t REG_BINARY /d 00000000000000000300000000005BE000005CE000000000 /f
```

Para devolverla: `reg delete "HKLM\SYSTEM\CurrentControlSet\Control\Keyboard Layout" /v "Scancode Map" /f` y reinicia.

### Recomendado en cada PC

1. Que los clientes usen una **cuenta de Windows estándar** (sin permisos de administrador) que inicie sesión sola. Así no pueden desinstalar el programa ni abrir herramientas de administrador.
2. Poner los juegos en **ventana sin bordes** cuando el juego lo permita. En pantalla completa exclusiva algunos juegos tapan el contador y el aviso de tiempo extra (el aviso sonoro y el bloqueo funcionan igual).

### Si el Administrador de tareas sigue abriendo

En algunas cuentas Windows no deja que un programa cambie esas políticas. Ponlas una vez a mano: abre PowerShell **como administrador** con la cuenta de los clientes y pega:

```powershell
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\System" /v DisableTaskMgr /t REG_DWORD /d 1 /f
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\System" /v DisableLockWorkstation /t REG_DWORD /d 1 /f
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\System" /v DisableChangePassword /t REG_DWORD /d 1 /f
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v NoLogoff /t REG_DWORD /d 1 /f
```

### Cómo deshacerlo

El programa quita esas políticas solo al entrar en mantenimiento, al cerrarlo con la clave y al desinstalarlo. Para quitarlas a mano:

```powershell
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\System" /v DisableTaskMgr /f
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\System" /v DisableLockWorkstation /f
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\System" /v DisableChangePassword /f
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v NoLogoff /f
```

## Estado de esta versión

Es la versión 0.2.3. La lógica (bloqueo, contador, tiempo extra, corte de internet, reconexión) está probada contra el servidor
en un entorno de pruebas con Linux. El bloqueo de teclas y las políticas de Windows solo existen en Windows y no se pudieron probar ahí. **Falta probarla en una PC real con Windows** antes de instalarla en toda la arena:
empieza por una sola máquina.
