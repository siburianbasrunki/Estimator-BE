import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config/auth";

export interface AuthenticatedRequest extends Request {
  userId?: string; 
}

export const authenticate = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.status(401).json({ error: "No token provided" });
    return;
  }

  const token = authHeader.split(" ")[1];

  try {
    // sesuaikan dengan payload JWT kamu (userId / id / role)
    const decoded = jwt.verify(token, config.jwtSecret) as {
      userId?: string;
      id?: string;
      role?: string;
    };

    const uid = decoded.userId ?? decoded.id;
    if (!uid) {
      res.status(401).json({ error: "Invalid token payload" });
      return;
    }

    req.userId = uid;
    // isi req.user sesuai augment (Partial<User> & {id, role?})
    (req as any).user = { id: uid, role: decoded.role ?? "USER" };

    next();
  } catch (error) {
    res.status(401).json({ error: "Invalid token" });
    return;
  }
};
