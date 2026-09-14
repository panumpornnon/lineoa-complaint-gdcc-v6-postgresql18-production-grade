import config from '../config.js';
import { ApiError } from '../errors.js';
import { verifyLineIdToken } from '../services/line.js';

export async function requireLineUser(req, res, next) {
  try {
    if (config.devBypassLineAuth) {
      req.lineUser = {
        userId: null,
        displayName: null,
        pictureUrl: null,
        isDevBypass: true,
      };
      return next();
    }

    const authorization = req.get('authorization') || '';
    const match = authorization.match(/^Bearer\s+(.+)$/i);

    if (!match) {
      throw new ApiError(401, 'กรุณาเข้าสู่ระบบผ่าน LINE ก่อนใช้งาน');
    }

    const profile = await verifyLineIdToken(match[1]);

    req.lineUser = {
      userId: profile.sub,
      displayName: profile.name || null,
      pictureUrl: profile.picture || null,
      isDevBypass: false,
    };

    return next();
  } catch (error) {
    return next(error);
  }
}
