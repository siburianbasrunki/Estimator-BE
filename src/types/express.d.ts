import { User } from "generated/prisma";
import { Multer } from "multer";

declare global {
  namespace Express {
    interface Request {
      user?: Partial<User> & { id: string; role?: string };
      file?: Multer.File;
      userId?: string;
    }
  }
}
