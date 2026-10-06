#define _GNU_SOURCE
#define _POSIX_C_SOURCE 200809L
#include <signal.h>
#include <pthread.h>
#include <errno.h>
#include <unistd.h>
#include <fcntl.h>
#include <sys/socket.h>
#include <time.h>

_Static_assert(sizeof(int) == 4, "Bun i32 ABI");
_Static_assert(sizeof(void *) == 8, "Linux-x64 ABI");

/* Test conditions/observations only. Never calls or substitutes a production
 * writer. Each sigset_t, sigaction and timespec is header-owned stack storage.
 * The isolated fixture owns its process disposition, current-thread mask and
 * returned fd. There is no retained memory, allocation, wait or background work.
 * Bun's public JS APIs do not expose pthread_sigmask/sigpending/sigtimedwait.
 * EX-0035 test boundary: retire when public host APIs expose these conditions. */
static int selected_signal(int slot) {
  return slot == 0 ? SIGPIPE : slot == 1 ? SIGUSR1 : -1;
}
int test_signal_bound(void) { return NSIG; }
int test_mask_member(int signal_number) {
  sigset_t mask;
  if (signal_number <= 0 || signal_number >= NSIG) return -EINVAL;
  int rc = pthread_sigmask(SIG_SETMASK, NULL, &mask);
  if (rc != 0) return -rc;
  int member = sigismember(&mask, signal_number);
  return member < 0 ? -errno : member;
}
int test_selected_member(int slot) {
  int sig = selected_signal(slot);
  return sig < 0 ? -EINVAL : test_mask_member(sig);
}
int test_set_blocked(int slot, int blocked) {
  sigset_t set;
  int sig = selected_signal(slot);
  if (sig < 0 || (blocked != 0 && blocked != 1)) return -EINVAL;
  if (sigemptyset(&set) < 0 || sigaddset(&set, sig) < 0) return -errno;
  int rc = pthread_sigmask(blocked ? SIG_BLOCK : SIG_UNBLOCK, &set, NULL);
  return rc == 0 ? 0 : -rc;
}
int test_pending(void) {
  sigset_t pending;
  if (sigpending(&pending) < 0) return -errno;
  int member = sigismember(&pending, SIGPIPE);
  return member < 0 ? -errno : member;
}
/* Only accepts the two standard dispositions, never serializes a handler.
 * Refuses an unexpected Bun/custom handler before changing any policy. */
int test_disposition(void) {
  struct sigaction action;
  if (sigaction(SIGPIPE, NULL, &action) < 0) return -errno;
  if (action.sa_handler == SIG_IGN) return 1;
  if (action.sa_handler == SIG_DFL) return 0;
  return -ENOTSUP;
}
int test_set_disposition(int ignored) {
  if (ignored != 0 && ignored != 1) return -EINVAL;
  struct sigaction action = {0};
  action.sa_handler = ignored ? SIG_IGN : SIG_DFL;
  if (sigemptyset(&action.sa_mask) < 0) return -errno;
  return sigaction(SIGPIPE, &action, NULL) < 0 ? -errno : 0;
}
int test_raise_pending(void) {
  if (test_selected_member(0) != 1 || test_disposition() != 0) return -EINVAL;
  int rc = pthread_kill(pthread_self(), SIGPIPE);
  return rc == 0 ? 0 : -rc;
}
int test_consume_pending(void) {
  sigset_t set;
  struct timespec zero = { .tv_sec = 0, .tv_nsec = 0 };
  if (test_selected_member(0) != 1) return -EINVAL;
  if (sigemptyset(&set) < 0 || sigaddset(&set, SIGPIPE) < 0) return -errno;
  int rc = sigtimedwait(&set, NULL, &zero);
  return rc == SIGPIPE ? 1 : rc < 0 && errno == EAGAIN ? 0 : -errno;
}
int test_epipe(void) { return EPIPE; }
int test_broken_fd(int socket_form) {
  int pair[2];
  if (socket_form != 0 && socket_form != 1) return -EINVAL;
  int rc = socket_form ? socketpair(AF_UNIX, SOCK_STREAM | SOCK_NONBLOCK, 0, pair)
                       : pipe2(pair, O_NONBLOCK | O_CLOEXEC);
  if (rc < 0) return -errno;
  if (close(pair[0]) < 0) {
    int saved = errno;
    (void)close(pair[1]);
    return -saved;
  }
  return pair[1];
}
int test_close(int fd) { return close(fd) < 0 ? -errno : 0; }
/* One synchronous fixture scope, not a per-write wrapper. Production symbols
 * never enter this library. Original policy stays on this C stack while the
 * JS fixture callback runs on the same calling thread. */
int test_scope(int (*fixture)(void)) {
  sigset_t original_mask;
  struct sigaction original_action;
  int rc = pthread_sigmask(SIG_SETMASK, NULL, &original_mask);
  if (rc != 0) return -rc;
  if (sigaction(SIGPIPE, NULL, &original_action) < 0) return -errno;
  if (test_pending() != 0 || test_disposition() < 0) return -EINVAL;
  int status = test_set_blocked(0, 1);
  if (status == 0) status = test_set_disposition(0);
  if (status == 0) status = fixture();
  int blocked = test_set_blocked(0, 1);
  int consumed = blocked == 0 ? test_consume_pending() : blocked;
  int action = sigaction(SIGPIPE, &original_action, NULL) < 0 ? -errno : 0;
  rc = pthread_sigmask(SIG_SETMASK, &original_mask, NULL);
  if (blocked < 0) return blocked;
  if (consumed < 0) return consumed;
  if (action < 0) return action;
  if (rc != 0) return -rc;
  return status;
}
