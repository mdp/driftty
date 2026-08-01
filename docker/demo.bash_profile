if [ -f "$HOME/.bashrc" ]; then
  . "$HOME/.bashrc"
fi

/usr/local/bin/driftty-demo-first-login ||
  printf 'The demo agent exited; continuing in bash.\n' >&2
