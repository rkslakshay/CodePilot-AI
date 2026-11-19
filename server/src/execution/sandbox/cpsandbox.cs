// CodePilot AI — Windows execution sandbox launcher.
//
// Compiled on first use with the C# compiler that ships with Windows (.NET Framework csc.exe),
// so no download is needed. It starts a program:
//   * inside a Job Object: memory cap, CPU-time cap, active-process cap (blocks spawning children),
//     kill-on-close (no orphans), UI restrictions (no clipboard / desktop / system settings);
//   * with a Low integrity-level token: the program cannot write to the user's files or to any
//     medium-integrity location (and cannot read folders protected with --protect).
// It does NOT block network access (that would need administrator firewall rules).
//
// Usage:
//   cpsandbox run --mem <MB> --cpu <ms> --procs <n> [--no-lowil] -- <exe> [args...]
//   cpsandbox protect <dir>      label a directory "no read-up / no write-up" at medium integrity
//   cpsandbox selftest
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

static class Sandbox
{
    // ---------------------------------------------------------------- Win32
    [StructLayout(LayoutKind.Sequential)]
    struct IO_COUNTERS { public ulong a, b, c, d, e, f; }

    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct STARTUPINFO
    {
        public int cb;
        public string lpReserved, lpDesktop, lpTitle;
        public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        public short wShowWindow, cbReserved2;
        public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId; }

    [StructLayout(LayoutKind.Sequential)]
    struct SID_AND_ATTRIBUTES { public IntPtr Sid; public uint Attributes; }

    [StructLayout(LayoutKind.Sequential)]
    struct TOKEN_MANDATORY_LABEL { public SID_AND_ATTRIBUTES Label; }

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr a, string name);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int cls, IntPtr info, uint len);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr proc);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr t);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr h, uint ms);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr h, out uint code);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateProcess(IntPtr h, uint code);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr GetStdHandle(int n);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetHandleInformation(IntPtr h, uint mask, uint flags);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool CreateProcess(string app, StringBuilder cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref STARTUPINFO si, out PROCESS_INFORMATION pi);
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool CreateProcessAsUser(IntPtr token, string app, StringBuilder cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref STARTUPINFO si, out PROCESS_INFORMATION pi);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr p, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool DuplicateTokenEx(IntPtr t, uint access, IntPtr attrs, int level, int type, out IntPtr newToken);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool SetTokenInformation(IntPtr t, int cls, IntPtr info, uint len);
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool ConvertStringSidToSid(string sid, out IntPtr psid);
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(string sddl, uint rev, out IntPtr sd, out uint size);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool GetSecurityDescriptorSacl(IntPtr sd, out bool present, out IntPtr sacl, out bool defaulted);
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern uint SetNamedSecurityInfo(string name, int type, uint info, IntPtr owner, IntPtr group, IntPtr dacl, IntPtr sacl);
    [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr p);

    const uint JOB_OBJECT_LIMIT_PROCESS_TIME = 0x2, JOB_OBJECT_LIMIT_ACTIVE_PROCESS = 0x8, JOB_OBJECT_LIMIT_PROCESS_MEMORY = 0x100,
        JOB_OBJECT_LIMIT_JOB_MEMORY = 0x200, JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION = 0x400, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
    const int JobObjectBasicUIRestrictions = 4, JobObjectExtendedLimitInformation = 9;
    const uint UILIMIT_ALL = 0xFF; // handles, clipboard read/write, system params, display settings, global atoms, desktop, exit windows
    const uint CREATE_SUSPENDED = 0x4, CREATE_NO_WINDOW = 0x08000000, CREATE_BREAKAWAY_FROM_JOB = 0x01000000, CREATE_UNICODE_ENVIRONMENT = 0x400;
    const int STARTF_USESTDHANDLES = 0x100;
    const uint HANDLE_FLAG_INHERIT = 1;
    const uint TOKEN_ALL_ACCESS = 0xF01FF;
    const int TokenIntegrityLevel = 25;
    const uint SE_GROUP_INTEGRITY = 0x20;
    const int SE_FILE_OBJECT = 1;
    const uint LABEL_SECURITY_INFORMATION = 0x10;

    // ---------------------------------------------------------------- helpers
    static string Quote(string a)
    {
        if (a.Length > 0 && a.IndexOfAny(new[] { ' ', '\t', '"' }) < 0) return a;
        var sb = new StringBuilder("\"");
        int bs = 0;
        foreach (char c in a)
        {
            if (c == '\\') { bs++; continue; }
            if (c == '"') { sb.Append('\\', bs * 2 + 1); sb.Append('"'); bs = 0; continue; }
            sb.Append('\\', bs); bs = 0; sb.Append(c);
        }
        sb.Append('\\', bs * 2).Append('"');
        return sb.ToString();
    }

    static IntPtr LowIntegrityToken()
    {
        IntPtr tok, dup, sid;
        if (!OpenProcessToken(GetCurrentProcess(), TOKEN_ALL_ACCESS, out tok)) throw new Win32Exception();
        if (!DuplicateTokenEx(tok, TOKEN_ALL_ACCESS, IntPtr.Zero, 2 /*impersonation*/, 1 /*primary*/, out dup)) throw new Win32Exception();
        CloseHandle(tok);
        if (!ConvertStringSidToSid("S-1-16-4096", out sid)) throw new Win32Exception(); // Low mandatory level
        var tml = new TOKEN_MANDATORY_LABEL { Label = new SID_AND_ATTRIBUTES { Sid = sid, Attributes = SE_GROUP_INTEGRITY } };
        int size = Marshal.SizeOf(tml) + 12;
        IntPtr buf = Marshal.AllocHGlobal(size);
        Marshal.StructureToPtr(tml, buf, false);
        bool ok = SetTokenInformation(dup, TokenIntegrityLevel, buf, (uint)size);
        Marshal.FreeHGlobal(buf);
        LocalFree(sid);
        if (!ok) throw new Win32Exception();
        return dup;
    }

    static IntPtr MakeJob(long memMb, long cpuMs, uint procs)
    {
        IntPtr job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero) throw new Win32Exception();
        var info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION | JOB_OBJECT_LIMIT_ACTIVE_PROCESS;
        info.BasicLimitInformation.ActiveProcessLimit = procs;
        if (memMb > 0)
        {
            info.BasicLimitInformation.LimitFlags |= JOB_OBJECT_LIMIT_PROCESS_MEMORY | JOB_OBJECT_LIMIT_JOB_MEMORY;
            info.ProcessMemoryLimit = new UIntPtr((ulong)memMb * 1024 * 1024);
            info.JobMemoryLimit = new UIntPtr((ulong)memMb * 1024 * 1024);
        }
        if (cpuMs > 0)
        {
            info.BasicLimitInformation.LimitFlags |= JOB_OBJECT_LIMIT_PROCESS_TIME;
            info.BasicLimitInformation.PerProcessUserTimeLimit = cpuMs * 10000; // 100 ns units
        }
        int len = Marshal.SizeOf(info);
        IntPtr p = Marshal.AllocHGlobal(len);
        Marshal.StructureToPtr(info, p, false);
        bool ok = SetInformationJobObject(job, JobObjectExtendedLimitInformation, p, (uint)len);
        Marshal.FreeHGlobal(p);
        if (!ok) throw new Win32Exception();
        IntPtr ui = Marshal.AllocHGlobal(4);
        Marshal.WriteInt32(ui, (int)UILIMIT_ALL);
        SetInformationJobObject(job, JobObjectBasicUIRestrictions, ui, 4);
        Marshal.FreeHGlobal(ui);
        return job;
    }

    static int Run(string[] args)
    {
        long mem = 256, cpu = 0;
        uint procs = 1;
        bool lowIl = true;
        int i = 1;
        for (; i < args.Length; i++)
        {
            if (args[i] == "--") { i++; break; }
            if (args[i] == "--mem") mem = long.Parse(args[++i]);
            else if (args[i] == "--cpu") cpu = long.Parse(args[++i]);
            else if (args[i] == "--procs") procs = uint.Parse(args[++i]);
            else if (args[i] == "--no-lowil") lowIl = false;
        }
        if (i >= args.Length) { Console.Error.WriteLine("cpsandbox: missing command"); return 2; }
        var cmd = new StringBuilder();
        for (int k = i; k < args.Length; k++) { if (k > i) cmd.Append(' '); cmd.Append(Quote(args[k])); }

        IntPtr job = MakeJob(mem, cpu, procs);
        var si = new STARTUPINFO();
        si.cb = Marshal.SizeOf(si);
        si.dwFlags = STARTF_USESTDHANDLES;
        si.hStdInput = GetStdHandle(-10);
        si.hStdOutput = GetStdHandle(-11);
        si.hStdError = GetStdHandle(-12);
        foreach (var h in new[] { si.hStdInput, si.hStdOutput, si.hStdError })
            if (h != IntPtr.Zero && h != new IntPtr(-1)) SetHandleInformation(h, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT);
        PROCESS_INFORMATION pi;
        uint flags = CREATE_SUSPENDED | CREATE_NO_WINDOW;
        bool started;
        if (lowIl)
        {
            IntPtr tok = LowIntegrityToken();
            started = CreateProcessAsUser(tok, null, cmd, IntPtr.Zero, IntPtr.Zero, true, flags, IntPtr.Zero, Environment.CurrentDirectory, ref si, out pi);
            CloseHandle(tok);
        }
        else started = CreateProcess(null, cmd, IntPtr.Zero, IntPtr.Zero, true, flags, IntPtr.Zero, Environment.CurrentDirectory, ref si, out pi);
        if (!started) { Console.Error.WriteLine("cpsandbox: could not start process: " + new Win32Exception().Message); return 3; }
        if (!AssignProcessToJobObject(job, pi.hProcess))
        {
            TerminateProcess(pi.hProcess, 1);
            Console.Error.WriteLine("cpsandbox: could not assign job: " + new Win32Exception().Message);
            return 4;
        }
        ResumeThread(pi.hThread);
        WaitForSingleObject(pi.hProcess, 0xFFFFFFFF);
        uint code;
        GetExitCodeProcess(pi.hProcess, out code);
        CloseHandle(pi.hThread);
        CloseHandle(pi.hProcess);
        CloseHandle(job); // kills anything left in the job
        return unchecked((int)code);
    }

    /** Medium-integrity label with NO_WRITE_UP | NO_READ_UP | NO_EXECUTE_UP, inherited by children. */
    static int Protect(string dir)
    {
        IntPtr sd;
        uint size;
        if (!ConvertStringSecurityDescriptorToSecurityDescriptor("S:(ML;OICI;NRNWNX;;;ME)", 1, out sd, out size)) throw new Win32Exception();
        bool present, defaulted;
        IntPtr sacl;
        if (!GetSecurityDescriptorSacl(sd, out present, out sacl, out defaulted)) throw new Win32Exception();
        uint rc = SetNamedSecurityInfo(dir, SE_FILE_OBJECT, LABEL_SECURITY_INFORMATION, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, sacl);
        LocalFree(sd);
        if (rc != 0) { Console.Error.WriteLine("cpsandbox: protect failed: " + new Win32Exception((int)rc).Message); return 5; }
        Console.WriteLine("protected");
        return 0;
    }

    static int Main(string[] args)
    {
        try
        {
            if (args.Length > 0 && args[0] == "run") return Run(args);
            if (args.Length > 1 && args[0] == "protect") return Protect(args[1]);
            if (args.Length > 0 && args[0] == "selftest") { IntPtr t = LowIntegrityToken(); CloseHandle(t); IntPtr j = MakeJob(64, 1000, 1); CloseHandle(j); Console.WriteLine("ok"); return 0; }
            Console.Error.WriteLine("usage: cpsandbox run|protect|selftest");
            return 2;
        }
        catch (Exception e)
        {
            Console.Error.WriteLine("cpsandbox: " + e.Message);
            return 6;
        }
    }
}
