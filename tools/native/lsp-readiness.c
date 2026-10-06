#define _POSIX_C_SOURCE 200809L
#include <poll.h>
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>
#include <stdint.h>
#include <sys/socket.h>
#include <signal.h>
#include <pthread.h>
#include <time.h>

_Static_assert(sizeof(int) == 4, "Bun i32 ABI requires 32-bit int");
_Static_assert(sizeof(void *) == 8, "Bun Linux-x64 ABI requires 64-bit pointers");

/* EX-0035: Linux-only synchronous ABI. No allocation, retained pointers, shared
 * flag mutation or process-global signal policy. Root owns descriptors/buffers,
 * validates pointer bounds and serializes a single retained output cursor.
 * count is at most 65536; C never dereferences the foreign pointer itself.
 * O_NONBLOCK does NOT establish a regular-storage syscall latency bound. */
int ready_now(int fd) {
  struct pollfd p = { .fd = fd, .events = POLLIN, .revents = 0 };
  int rc = poll(&p, 1, 0);
  return rc < 0 ? -errno : (int)p.revents;
}
int fd_flags(int fd) { return fcntl(fd, F_GETFL); }
int poll_in(void) { return POLLIN; }
int poll_hup(void) { return POLLHUP; }
int poll_err(void) { return POLLERR; }
int poll_invalid(void) { return POLLNVAL; }
int pollfd_size(void) { return (int)sizeof(struct pollfd); }

int output_ready_now(int fd) {
  struct pollfd p = { .fd = fd, .events = POLLOUT, .revents = 0 };
  int rc = poll(&p, 1, 0);
  return rc < 0 ? -errno : (int)p.revents;
}
int poll_out(void) { return POLLOUT; }

/* Reopening procfd creates a new open file description, not dup's shared flags.
 * FIFO/PTY acquisition is nonblocking. The returned fd belongs to the root;
 * neither fd 1 nor its open-file-description flags are changed or closed here. */
int open_output_now(void) {
  int flags = fcntl(STDOUT_FILENO, F_GETFL);
  if (flags < 0) return -errno;
  int access = flags & O_ACCMODE;
  if (access != O_WRONLY && access != O_RDWR) return -EBADF;
  int fd = open("/proc/self/fd/1",
                access | (flags & O_APPEND) | O_NONBLOCK | O_CLOEXEC);
  return fd < 0 ? -errno : fd;
}

int socket_write_now(int fd, const void *buffer, uint32_t count) {
  if (count > 65536) return -EINVAL;
  if (count == 0) return 0;
  if (buffer == NULL) return -EFAULT;
  ssize_t rc = send(fd, buffer, count, MSG_DONTWAIT | MSG_NOSIGNAL);
  return rc < 0 ? -errno : (int)rc;
}

/* fd is root-owned: independently opened O_NONBLOCK for FIFO/PTY, or original
 * regular-output fd 1 to preserve inherited offset (storage may block).
 * POSIX write generates SIGPIPE for the calling thread on EPIPE. Block it only
 * in that thread, retain any pre-existing pending signal, consume a new one,
 * then restore exactly the old mask. No handler or global ignore is installed.
 * https://pubs.opengroup.org/onlinepubs/9799919799/functions/write.html
 * https://pubs.opengroup.org/onlinepubs/9799919799/functions/pthread_sigmask.html
 * Linux zero-time sigtimedwait dequeues without sleeping/retrying (ret starts 0):
 * https://github.com/torvalds/linux/blob/v6.18/kernel/signal.c#L3745-L3793
 * Standard headers own sigset_t/timespec; no private layout crosses the ABI. */
int fd_write_now(int fd, const void *buffer, uint32_t count) {
  if (count > 65536) return -EINVAL;
  if (count == 0) return 0;
  if (buffer == NULL) return -EFAULT;

  sigset_t pipe_set, old_mask, pending;
  if (sigemptyset(&pipe_set) < 0) return -errno;
  if (sigaddset(&pipe_set, SIGPIPE) < 0) return -errno;
  int mask_error = pthread_sigmask(SIG_BLOCK, &pipe_set, &old_mask);
  if (mask_error != 0) return -mask_error;
  if (sigpending(&pending) < 0) {
    int saved_error = errno;
    mask_error = pthread_sigmask(SIG_SETMASK, &old_mask, NULL);
    return mask_error != 0 ? -mask_error : -saved_error;
  }
  int already_pending = sigismember(&pending, SIGPIPE);
  if (already_pending < 0) {
    int saved_error = errno;
    mask_error = pthread_sigmask(SIG_SETMASK, &old_mask, NULL);
    return mask_error != 0 ? -mask_error : -saved_error;
  }

  ssize_t rc = write(fd, buffer, count);
  int saved_error = rc < 0 ? errno : 0;
  if (saved_error == EPIPE && !already_pending) {
    struct timespec zero = { .tv_sec = 0, .tv_nsec = 0 };
    /* SIGPIPE or EAGAIN (ignored/no longer pending), never a timed wait. */
    (void)sigtimedwait(&pipe_set, NULL, &zero);
  }
  mask_error = pthread_sigmask(SIG_SETMASK, &old_mask, NULL);
  if (mask_error != 0) return -mask_error;
  return rc < 0 ? -saved_error : (int)rc;
}

int io_would_block(int result) {
  return result == -EAGAIN || result == -EWOULDBLOCK || result == -EINTR;
}
