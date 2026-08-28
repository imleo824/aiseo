import { PrismaClient } from '@prisma/client';

const [emailArgument, ...reasonParts] = process.argv.slice(2);
const email = emailArgument?.trim().toLowerCase();
const reason = reasonParts.join(' ').trim();
const databaseUrl = process.env.DATABASE_ADMIN_URL?.trim();

if (!databaseUrl) throw new Error('DATABASE_ADMIN_URL is required');
if (!email || !/^\S+@\S+\.\S+$/.test(email)) throw new Error('Usage: npm run admin:bootstrap -- admin@example.com "approval reason"');
if (reason.length < 10) throw new Error('An approval reason of at least 10 characters is required');

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

try {
  const result = await prisma.$transaction(async (tx) => {
    const profile = await tx.profile.findUnique({ where: { email } });
    if (!profile) throw new Error('The Supabase Auth user must register and verify email before bootstrap');
    if (profile.platformRole === 'PLATFORM_ADMIN') throw new Error('The profile is already a platform administrator');
    const updated = await tx.profile.update({ where: { id: profile.id }, data: { platformRole: 'PLATFORM_ADMIN' } });
    const audit = await tx.auditEvent.create({ data: { actorId: profile.id, action: 'PLATFORM_ADMIN_BOOTSTRAPPED', targetType: 'profile', targetId: profile.id, metadata: { reason, command: 'admin:bootstrap' } } });
    return { profileId: updated.id, email: updated.email, auditEventId: audit.id };
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await prisma.$disconnect();
}
