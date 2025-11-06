#!/bin/bash

if ! command -v node &> /dev/null
then
    echo "Node.js is not installed."
    exit 1
fi

if ! command -v npm &> /dev/null
then
    echo "npm is not installed."
    exit 1
fi

npm install --no-audit
node server.js "$@"