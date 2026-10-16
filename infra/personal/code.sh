#!/bin/sh
# Local only: print the current 6-digit login code for the account in .local/login.txt.
cd "$(dirname "$0")" || exit 1
secret=$(sed -n 's/^totp_secret=//p' .local/login.txt)
docker compose exec -T anotar node --input-type=module -e "import {totp} from './server/auth/crypto.mjs'; console.log(totp(process.argv[1]))" "$secret"
