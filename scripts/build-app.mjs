#!/usr/bin/env node

import { execSync } from 'node:child_process'

function run(command) {
  console.log(`$ ${command}`)
  execSync(command, {
    stdio: 'inherit',
    env: {
      ...process.env,
      PRISMA_HIDE_UPDATE_MESSAGE: process.env.PRISMA_HIDE_UPDATE_MESSAGE || '1',
    },
  })
}

function isVercelBuildEnv() {
  return process.env.VERCEL === '1'
    || typeof process.env.VERCEL_ENV === 'string'
    || typeof process.env.VERCEL_URL === 'string'
}

const shouldSkipMigrate = process.env.SKIP_DB_MIGRATE_DURING_BUILD === '1' || isVercelBuildEnv()

if (process.argv.includes('--print-plan')) {
  console.log(JSON.stringify({
    shouldSkipMigrate,
    commands: shouldSkipMigrate
      ? ['prisma generate', 'next build']
      : ['prisma migrate deploy', 'prisma generate', 'next build'],
  }, null, 2))
  process.exit(0)
}

if (shouldSkipMigrate) {
  console.log('Skipping `prisma migrate deploy` during build.')
} else {
  run('prisma migrate deploy')
}

run('prisma generate')
run('next build')
