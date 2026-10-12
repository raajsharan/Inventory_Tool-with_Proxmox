// Shared password-complexity rule: at least 8 characters, with at least one
// lowercase letter, one uppercase letter, and one digit. Used everywhere a
// password is set or changed — self-service and admin-issued alike — so an
// admin can't quietly set a weaker password for someone else than that
// person could ever set for themselves.
const PASSWORD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
const PASSWORD_MESSAGE = 'Password must be at least 8 characters and include uppercase, lowercase, and a number';

function isValidPassword(password) {
  return typeof password === 'string' && PASSWORD_RE.test(password);
}

module.exports = { PASSWORD_RE, PASSWORD_MESSAGE, isValidPassword };
