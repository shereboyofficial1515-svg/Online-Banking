import multer from 'multer';
import config from '../config/index.js';

// Memory storage + hard size/count limits. Content type is verified by magic bytes in the services, not here.
const base = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.upload.maxBytes, files: 3, fields: 10 } });
export const uploadOne = (field) => base.single(field);
export const uploadMany = (field) => base.array(field, 3);
