#!/bin/bash

if ! command -v node > /dev/null 2>&1; then
    echo "Node.js is not installed."
    exit 1
fi

if ! command -v npm > /dev/null 2>&1; then
    echo "npm is not installed."
    exit 1
fi

cp -f mikupad.html project

cd project
npm install
npm run build
cp -f ./dist/mikupad.html ../mikupad_compiled.html
cd ..