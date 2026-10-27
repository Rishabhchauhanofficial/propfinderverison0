/** Same rule as the server (authController.validatePassword). Returns an error message or ''. */
export function passwordProblem(pw) {
  const s = String(pw || '');
  if (s.length < 8 || !/[A-Za-z]/.test(s) || !/\d/.test(s)) return 'Password must be at least 8 characters with a letter and a number.';
  return '';
}
