#!/usr/bin/env tsx

import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

function getAdminEmails(): string[] {
  return (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)
}

function createPrismaClient() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set')
  }

  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString: process.env.DATABASE_URL,
      max: 5,
    }),
  })
}

async function main() {
  const prisma = createPrismaClient()
  
  try {
    const adminEmails = getAdminEmails()
    
    if (adminEmails.length === 0) {
      console.log('No admin emails found in ADMIN_EMAILS env var')
      return
    }
    
    console.log(`Found ${adminEmails.length} admin email(s):`, adminEmails)
    
    const result = await prisma.admin.createMany({
      data: adminEmails.map(email => ({ email, active: true })),
      skipDuplicates: true
    })
    
    console.log(`✓ Created/updated ${result.count} admin record(s)`)
    
    const updatedAdmins = await prisma.admin.findMany({
      where: {
        email: {
          in: adminEmails
        }
      },
      select: {
        email: true,
        active: true
      }
    })
    
    console.log('\nAdmin records:')
    updatedAdmins.forEach(admin => {
      console.log(`  - ${admin.email} (active: ${admin.active})`)
    })
    
    const foundEmails = updatedAdmins.map(a => a.email.toLowerCase()).filter(Boolean)
    const notFoundEmails = adminEmails.filter(email => !foundEmails.includes(email))
    
    if (notFoundEmails.length > 0) {
      console.log('\n⚠ Warning: The following admin emails were not processed:')
      notFoundEmails.forEach(email => {
        console.log(`  - ${email}`)
      })
    }
    
  } catch (error) {
    console.error('Migration failed:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

main()
