# Runbook — server deploy (AWS, ap-south-1)

Infrastructure is code (`sawa_infra`, CDK). Day-to-day deploys don't touch it.

## Ship a server change

1. Gates: `npx tsc --noEmit` · `npx jest --runInBand` (all green) ·
   `node scripts/syncContracts.mjs --check`.
2. Build + push the image (Docker, ARM64):
   ```
   docker build --platform linux/arm64 -t sawa-server:local .
   aws ecr get-login-password --profile sawa | docker login --username AWS --password-stdin 528087309069.dkr.ecr.ap-south-1.amazonaws.com
   docker tag sawa-server:local 528087309069.dkr.ecr.ap-south-1.amazonaws.com/sawa-server-<stage>:latest
   docker push 528087309069.dkr.ecr.ap-south-1.amazonaws.com/sawa-server-<stage>:latest
   ```
3. Bounce the service:
   `aws ecs update-service --profile sawa --cluster sawa-<stage> --service sawa-api-<stage> --force-new-deployment`
4. Watch it land: `aws ecs wait services-stable ...` then
   `curl https://api[-staging].sawaliving.in/health` → `db: ok`.
5. Schema applies itself on boot (`npm start` runs `prisma db push`).

## Change runtime config / secrets

Everything lives in ONE Secrets Manager secret per stage:
`sawa/<stage>/server-env` (flat JSON; `src/config/env.ts` is the contract).
Update the JSON → force a new deployment (step 3). Every key referenced by
`sawa_infra/lib/app.ts` MUST exist in the JSON or tasks fail to start.

## Raise the force-update floor (retire old app builds)

Set `MIN_APP_BUILD_ANDROID` / `MIN_APP_BUILD_IOS` in the env secret to the
minimum allowed build number, bounce the service. Older builds get 426 + the
blocking update screen. `0` = gate off. Header-less callers (admin/web) are
never gated.

## Data repair

`npx ts-node src/scripts/repairCoupleIdentity.ts` — dry-run by default,
`--apply` to write. Run after any incident touching couple identity, and once
right after each environment's first data import.
