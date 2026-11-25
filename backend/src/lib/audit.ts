// Writes a line to the audit log. Never stops the request if the write fails.
import { prisma } from '../db/prisma.js';

export async function audit(userId: number | null, action: string, detail = ''): Promise<void> {
  try {
    await prisma.auditLog.create({ data: { userId, action, detail } });
  } catch (e) {
    console.error('audit log write failed', e);
  }
}
