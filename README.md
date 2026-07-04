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

## Development

This repository is initialized as a pnpm workspace.

```bash
corepack enable
corepack prepare pnpm@10.6.1 --activate
pnpm install
pnpm dev
```

## Planning Docs

The initial product and architecture planning lives outside this repository for now:

```text
../营销平台
```
