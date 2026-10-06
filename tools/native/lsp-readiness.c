#include <poll.h>
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>

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
