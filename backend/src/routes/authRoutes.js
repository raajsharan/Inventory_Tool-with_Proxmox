const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { body } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const c = require('../controllers/authController');

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

/**
 * @openapi
 * /auth/login:
 *   post:
 *     summary: Login and receive a JWT
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content: { application/json: { schema: { type: object, properties: { email: { type: string }, password: { type: string } } } } }
 *     responses:
 *       200: { description: OK }
 *       401: { description: Invalid credentials }
 */
router.post(
  '/login',
  loginLimiter,
  body('email').isEmail(),
  body('password').isLength({ min: 4 }),
  validate,
  c.login
);

router.get('/me', authenticate, c.me);
router.put('/me', authenticate, c.updateProfile);
router.post('/me/change-password', authenticate, c.changePassword);

module.exports = router;
