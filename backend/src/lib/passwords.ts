// Password hashing with bcrypt.
import bcrypt from 'bcryptjs';

const COST = 12;
// Compared against when the phone number is unknown, so a wrong phone takes as long as a wrong password.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', COST);

export const hashPassword = (password: string) => bcrypt.hash(password, COST);

export async function verifyPassword(password: string, hash: string | null | undefined): Promise<boolean> {
  const ok = await bcrypt.compare(password, hash ?? DUMMY_HASH);
  return Boolean(hash) && ok;
}
