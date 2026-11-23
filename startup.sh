#!/bin/bash

export PATH="$HOME/.bun/bin:$PATH"

fuser -k 3000/tcp

bun run build
bun start
