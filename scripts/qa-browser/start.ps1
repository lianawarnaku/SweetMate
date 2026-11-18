$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "../..")
node scripts/qa-browser/start.mjs
