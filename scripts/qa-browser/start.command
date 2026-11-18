#!/bin/bash
set -e
cd "$(dirname "$0")/../.."
node scripts/qa-browser/start.mjs
