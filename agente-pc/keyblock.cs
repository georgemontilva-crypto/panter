// keyblock.exe: guardia de teclado de Panter Bloqueo.
//
// Un programa normal (como la ventana de bloqueo) no puede impedir que Windows atienda la tecla
// Windows, Alt+Tab o Ctrl+Esc. Este ayudante instala un gancho de teclado de bajo nivel y, mientras
// la PC está bloqueada, descarta esas combinaciones antes de que lleguen a Windows.
//
// Lo arranca Panter Bloqueo y le da órdenes por la entrada estándar:
//   lock          -> PC bloqueada: descarta todas las teclas del sistema
//   session       -> cliente jugando con la pantalla de juegos: descarta solo la tecla Windows y Ctrl+Esc,
//                    y deja Alt+Tab para cambiar entre el juego y Discord
//   unlock        -> deja pasar todo (mantenimiento, o sin pantalla de juegos)
//   taskbar-hide  -> esconde la barra de tareas de Windows (con ella se llegaría al menú Inicio con el ratón)
//   taskbar-show  -> la vuelve a mostrar
//   quit          -> termina
// Por seguridad nunca deja la PC a medias si el programa principal desaparece: al terminar, por la razón
// que sea, suelta las teclas y devuelve la barra de tareas.
//
// Se compila en GitHub Actions con el compilador de C# que trae Windows (csc, C# 5).

using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

static class KeyBlock
{
    const int WH_KEYBOARD_LL = 13;
    const uint LLKHF_ALTDOWN = 0x20;

    const uint VK_TAB = 0x09;
    const uint VK_ESCAPE = 0x1B;
    const uint VK_SPACE = 0x20;
    const uint VK_LWIN = 0x5B;
    const uint VK_RWIN = 0x5C;
    const uint VK_APPS = 0x5D;
    const uint VK_F4 = 0x73;
    const int VK_CONTROL = 0x11;

    [StructLayout(LayoutKind.Sequential)]
    struct KBDLLHOOKSTRUCT
    {
        public uint vkCode;
        public uint scanCode;
        public uint flags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct MSG
    {
        public IntPtr hwnd;
        public uint message;
        public IntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public int x;
        public int y;
    }

    delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    static extern IntPtr SetWindowsHookEx(int idHook, HookProc lpfn, IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll")]
    static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll")]
    static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    static extern int GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);

    [DllImport("user32.dll")]
    static extern short GetAsyncKeyState(int vKey);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr GetModuleHandle(string lpModuleName);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr FindWindow(string lpClassName, string lpWindowName);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr FindWindowEx(IntPtr parent, IntPtr childAfter, string lpClassName, string lpWindowName);

    [DllImport("user32.dll")]
    static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    const int SW_HIDE = 0;
    const int SW_SHOWNA = 8;

    // 0 = no se descarta nada, 1 = sesión (tecla Windows), 2 = bloqueo total.
    static volatile int mode = 0;
    static volatile bool taskbarHidden = false;

    // La barra de tareas principal y las de los monitores adicionales. Devuelve cuántas encontró.
    static int SetTaskbar(bool visible)
    {
        int count = 0;
        IntPtr main = FindWindow("Shell_TrayWnd", null);
        if (main != IntPtr.Zero) { ShowWindow(main, visible ? SW_SHOWNA : SW_HIDE); count++; }
        IntPtr other = IntPtr.Zero;
        while ((other = FindWindowEx(IntPtr.Zero, other, "Shell_SecondaryTrayWnd", null)) != IntPtr.Zero)
        {
            ShowWindow(other, visible ? SW_SHOWNA : SW_HIDE);
            count++;
        }
        taskbarHidden = !visible;
        return count;
    }

    static void Leave()
    {
        try { if (taskbarHidden) SetTaskbar(true); } catch (Exception) { }
        Environment.Exit(0);
    }

    static IntPtr hook = IntPtr.Zero;
    // Se guarda en un campo para que el recolector de basura no libere el delegado mientras Windows lo usa.
    static HookProc callback = new HookProc(OnKey);

    static IntPtr OnKey(int nCode, IntPtr wParam, IntPtr lParam)
    {
        int current = mode;
        if (nCode >= 0 && current > 0)
        {
            KBDLLHOOKSTRUCT key = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
            uint vk = key.vkCode;
            bool alt = (key.flags & LLKHF_ALTDOWN) != 0;
            bool ctrl = (GetAsyncKeyState(VK_CONTROL) & 0x8000) != 0;

            // Siempre que haya algo que proteger: la tecla Windows y Ctrl+Esc (las dos abren el menú Inicio).
            bool systemKey = vk == VK_LWIN || vk == VK_RWIN || (ctrl && vk == VK_ESCAPE);
            // Solo con la PC bloqueada: menú contextual, Alt+Tab, Alt+Esc, Alt+F4 y Alt+Espacio.
            if (current == 2)
                systemKey = systemKey || vk == VK_APPS || (alt && (vk == VK_TAB || vk == VK_ESCAPE || vk == VK_F4 || vk == VK_SPACE));

            // Devolver 1 descarta la tecla: Windows nunca se entera de que se pulsó.
            if (systemKey) return (IntPtr)1;
        }
        return CallNextHookEx(hook, nCode, wParam, lParam);
    }

    static void WatchParent(int pid)
    {
        Thread watcher = new Thread(delegate()
        {
            try { Process.GetProcessById(pid).WaitForExit(); }
            catch (Exception) { }
            Leave();
        });
        watcher.IsBackground = true;
        watcher.Start();
    }

    static void ReadCommands()
    {
        Thread reader = new Thread(delegate()
        {
            try
            {
                string line;
                while ((line = Console.In.ReadLine()) != null)
                {
                    line = line.Trim();
                    if (line == "lock") mode = 2;
                    else if (line == "session") mode = 1;
                    else if (line == "unlock") mode = 0;
                    else if (line == "taskbar-hide") { Console.Out.WriteLine("taskbar hidden " + SetTaskbar(false)); Console.Out.Flush(); }
                    else if (line == "taskbar-show") { Console.Out.WriteLine("taskbar shown " + SetTaskbar(true)); Console.Out.Flush(); }
                    else if (line == "quit") break;
                }
            }
            catch (Exception) { }
            // Entrada cerrada u orden de salir: se termina, las teclas quedan libres y vuelve la barra de tareas.
            Leave();
        });
        reader.IsBackground = true;
        reader.Start();
    }

    static int Main(string[] args)
    {
        int parentPid;
        if (args.Length > 0 && int.TryParse(args[0], out parentPid) && parentPid > 0) WatchParent(parentPid);

        string module = Process.GetCurrentProcess().MainModule.ModuleName;
        hook = SetWindowsHookEx(WH_KEYBOARD_LL, callback, GetModuleHandle(module), 0);
        if (hook == IntPtr.Zero)
        {
            Console.Error.WriteLine("hook-failed " + Marshal.GetLastWin32Error());
            return 2;
        }
        Console.Out.WriteLine("ready");
        Console.Out.Flush();
        // Las órdenes se empiezan a leer con el gancho ya instalado.
        ReadCommands();

        // El gancho solo recibe teclas mientras este hilo atiende su cola de mensajes.
        MSG msg;
        while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) { }
        UnhookWindowsHookEx(hook);
        return 0;
    }
}
