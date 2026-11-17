// keyblock.exe: guardia de teclado de Panter Bloqueo.
//
// Un programa normal (como la ventana de bloqueo) no puede impedir que Windows atienda la tecla
// Windows, Alt+Tab o Ctrl+Esc. Este ayudante instala un gancho de teclado de bajo nivel y, mientras
// la PC está bloqueada, descarta esas combinaciones antes de que lleguen a Windows.
//
// Lo arranca Panter Bloqueo y le da órdenes por la entrada estándar:
//   lock    -> empieza a descartar las teclas del sistema
//   unlock  -> deja pasar todo (el cliente está jugando)
//   quit    -> termina
// Por seguridad nunca deja teclas bloqueadas si el programa principal desaparece: termina solo
// cuando se cierra la entrada estándar o cuando muere el proceso que lo lanzó.
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

    static volatile bool blocking = false;
    static IntPtr hook = IntPtr.Zero;
    // Se guarda en un campo para que el recolector de basura no libere el delegado mientras Windows lo usa.
    static HookProc callback = new HookProc(OnKey);

    static IntPtr OnKey(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0 && blocking)
        {
            KBDLLHOOKSTRUCT key = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
            uint vk = key.vkCode;
            bool alt = (key.flags & LLKHF_ALTDOWN) != 0;
            bool ctrl = (GetAsyncKeyState(VK_CONTROL) & 0x8000) != 0;

            bool systemKey =
                vk == VK_LWIN || vk == VK_RWIN || vk == VK_APPS ||                        // tecla Windows y menú contextual
                (alt && (vk == VK_TAB || vk == VK_ESCAPE || vk == VK_F4 || vk == VK_SPACE)) || // Alt+Tab, Alt+Esc, Alt+F4, Alt+Espacio
                (ctrl && vk == VK_ESCAPE);                                                // Ctrl+Esc y Ctrl+Mayús+Esc

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
            Environment.Exit(0);
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
                    if (line == "lock") blocking = true;
                    else if (line == "unlock") blocking = false;
                    else if (line == "quit") break;
                }
            }
            catch (Exception) { }
            // Entrada cerrada u orden de salir: se termina y las teclas quedan libres.
            Environment.Exit(0);
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
