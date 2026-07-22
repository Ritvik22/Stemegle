#include <errno.h>
#include <grp.h>
#include <seccomp.h>
#include <stdio.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <unistd.h>

static int deny_syscall(scmp_filter_ctx filter, int syscall_number) {
  return seccomp_rule_add(filter, SCMP_ACT_ERRNO(EPERM), syscall_number, 0);
}

static int set_limit(int resource, rlim_t soft, rlim_t hard) {
  struct rlimit limit = { soft, hard };
  return setrlimit(resource, &limit);
}

int main(int argc, char **argv) {
  if (argc < 2) return 64;

  if (set_limit(RLIMIT_CORE, 0, 0) != 0
      || set_limit(RLIMIT_FSIZE, 32 * 1024 * 1024, 32 * 1024 * 1024) != 0
      || set_limit(RLIMIT_NOFILE, 64, 64) != 0
      || set_limit(RLIMIT_NPROC, 32, 32) != 0) {
    perror("sandbox limits");
    return 70;
  }

  if (setgroups(0, NULL) != 0 || setgid(65534) != 0 || setuid(65534) != 0) {
    perror("sandbox identity");
    return 70;
  }
  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) {
    perror("sandbox privileges");
    return 70;
  }

  scmp_filter_ctx filter = seccomp_init(SCMP_ACT_ALLOW);
  if (!filter) return 70;
  const int blocked[] = {
    SCMP_SYS(socket), SCMP_SYS(socketpair), SCMP_SYS(connect), SCMP_SYS(bind),
    SCMP_SYS(listen), SCMP_SYS(accept), SCMP_SYS(accept4), SCMP_SYS(ptrace),
    SCMP_SYS(process_vm_readv), SCMP_SYS(process_vm_writev), SCMP_SYS(kill),
    SCMP_SYS(tkill), SCMP_SYS(tgkill), SCMP_SYS(pidfd_send_signal),
    SCMP_SYS(mount), SCMP_SYS(umount2), SCMP_SYS(pivot_root), SCMP_SYS(chroot),
    SCMP_SYS(setuid), SCMP_SYS(setgid), SCMP_SYS(setreuid), SCMP_SYS(setregid),
    SCMP_SYS(setresuid), SCMP_SYS(setresgid), SCMP_SYS(setgroups),
  };
  for (unsigned long index = 0; index < sizeof(blocked) / sizeof(blocked[0]); index += 1) {
    if (deny_syscall(filter, blocked[index]) != 0) {
      seccomp_release(filter);
      return 70;
    }
  }
  if (seccomp_load(filter) != 0) {
    seccomp_release(filter);
    return 70;
  }
  seccomp_release(filter);
  execvp(argv[1], &argv[1]);
  perror("sandbox exec");
  return 70;
}
