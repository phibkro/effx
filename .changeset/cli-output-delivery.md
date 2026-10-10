---
"@effx/cli": patch
---

Print every command's output through the process's standard output stream. `check`, `build`, `dev`, `inspect`, `graph`, `explain`, `surface check` and `cedar` printed through the global console, which does not retry when a pipe or socket is full: output larger than the buffer reached a slow reader as a prefix. Each command now writes through one function that waits for the stream, so a slow reader receives the same bytes and exit code as a redirect to a file. An LSP session still keeps stdout for the protocol: what a command prints there goes to stderr. A real-child suite reads every command's output slowly and compares it with the file.
