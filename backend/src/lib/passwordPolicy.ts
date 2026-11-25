// Rules for a new password. Returns a message the user can act on, or null if the password is fine.
export function passwordProblem(password: string, phone?: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters.';
  if (Buffer.byteLength(password, 'utf8') > 72) return 'Password is too long (at most 72 characters).';
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return 'Password must have at least one letter and one number.';
  if (phone && password.includes(phone)) return 'Password must not contain your phone number.';
  return null;
}
