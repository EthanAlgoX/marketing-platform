# Marketing Platform

AI-assisted multi-platform marketing content workspace.

## Planned Stack

- Next.js + React + TypeScript
- NestJS + Prisma
- PostgreSQL
- Redis + BullMQ
- S3-compatible object storage
- OpenAI API adapter

## Workspace Layout

```text
apps/
  web/
  api/
  worker/

packages/
  database/
  providers/
  shared/

infra/
  docker/

docs/
```

## Local Infrastructure

```bash
docker compose up -d
```

Without Docker, install and start PostgreSQL + Redis locally, then keep `.env`
aligned with the listening ports.

Check local readiness before running the publish loop:

```bash
pnpm env:check
```

## Development

This repository is initialized as a pnpm workspace.

```bash
corepack enable
corepack prepare pnpm@10.6.1 --activate
pnpm install
pnpm dev
```

### Smoke Loop

```bash
pnpm loop:publish-smoke
```

Run this script only when API + worker services are online. It executes:

- create user/organization
- create content item
- generate versions for xiaohongshu/zhihu/x_twitter
- create platform accounts
- create publish task, enqueue `run`, and poll state
- auto fill `manual_required` targets

## Planning Docs

The initial product and architecture planning lives outside this repository for now:

```text
../营销平台
```
