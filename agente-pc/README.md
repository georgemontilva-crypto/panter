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

## Crear el instalador (se hace una sola vez, en una PC con Windows)

Necesitas Node.js 20 o más nuevo. En PowerShell, dentro de la carpeta del repo:

```powershell
cd agente-pc
npm install
npm run dist
```

El instalador queda en `agente-pc\dist\Panter Bloqueo Setup 0.1.0.exe`. Cópialo a un pendrive.

Para probarlo sin instalar:

```powershell
cd agente-pc
npm install
npm start
```

## Instalar en cada PC

1. En la web: **Caja → Ajustes → Estaciones**. Crea la PC con su número y pulsa **Generar credencial**. Copia el texto que empieza por `pc_`.
2. En la PC, ejecuta el instalador. Al abrirse por primera vez pide tres datos:
   - **Dirección de la web:** por ejemplo `https://tu-dominio.com`
   - **Credencial de la PC:** la que copiaste (una distinta por máquina)
   - **Clave de mantenimiento:** la que usará el personal para cerrar el programa
3. Pulsa **Conectar**. La PC muestra su número y queda bloqueada. Desde ese momento el programa arranca solo al iniciar sesión en Windows.

## Mantenimiento

- **Desbloquear una PC sin cobrar** (instalar juegos, actualizar): Caja → Ajustes → Estaciones → *Desbloquear 30 min*.
- **Cerrar el programa en la PC:** en la pantalla de bloqueo pulsa `Ctrl + Mayús + M` y escribe la clave de mantenimiento.
- **Cambiar la credencial o la dirección:** `Ctrl + Mayús + M` → *Volver a configurar*.

## Para que el bloqueo sea difícil de saltar

Un programa normal no puede bloquear `Ctrl + Alt + Supr` ni la tecla Windows: eso lo controla Windows. Por eso cada PC debe quedar así:

1. Los clientes usan una **cuenta de Windows estándar** (sin permisos de administrador) que inicia sesión sola.
2. En esa cuenta, desactiva el Administrador de tareas. En PowerShell, con esa cuenta abierta:

   ```powershell
   reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\System" /v DisableTaskMgr /t REG_DWORD /d 1 /f
   ```

3. Pon los juegos en **ventana sin bordes** cuando el juego lo permita. En pantalla completa exclusiva algunos juegos tapan el contador y el aviso de tiempo extra (el aviso sonoro y el bloqueo funcionan igual).

## Estado de esta versión

Es la versión 0.1. La lógica (bloqueo, contador, tiempo extra, corte de internet, reconexión) está probada contra el servidor
en un entorno de pruebas con Linux. **Falta probarla en una PC real con Windows** antes de instalarla en toda la arena:
empieza por una sola máquina.
