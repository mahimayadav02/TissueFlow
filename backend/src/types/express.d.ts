import type { Role } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      /** The signed-in user, set by requireAuth. */
      user?: {
        userId: number;
        fullName: string;
        role: Role;
        homeAreaId: number | null;
        /** Supervisor: zones they look after. Operator: extra zones besides the home zone. */
        zoneIds: number[];
      };
    }
  }
}
export {};
