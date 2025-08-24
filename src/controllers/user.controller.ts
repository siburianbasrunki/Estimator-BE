import { Request, Response } from "express";
import {
  deleteFromCloudinary,
  uploadToCloudinary,
} from "../utils/cloudinaryUpload";
import { userClient } from "../lib/prisma";

export interface AuthenticatedRequest extends Request {
  userId?: string;
  userRole?: Role;
}

enum Role {
  USER = "USER",
  ADMIN = "ADMIN",
}

export const getAllUsers = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const users = await userClient.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        phoneNumber: true,
        role: true,
        imageUrl: true,
        createdAt: true,
      },
    });

    res.status(200).json({ data: users });
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ error: "Failed to fetch users" });
  }
};

export const getUserById = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.params.id;

    const user = await userClient.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        phoneNumber: true,
        role: true,
        imageUrl: true,
        createdAt: true,
      },
    });

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.status(200).json({ data: user });
  } catch (error) {
    console.error("Error fetching user:", error);
    res.status(500).json({ error: "Failed to fetch user" });
  }
};

export const updateUser = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.params.id;
    const { name, phoneNumber, role } = req.body;

    if (!name && !phoneNumber && !role && !req.file) {
      res.status(400).json({ error: "No update data provided" });
      return;
    }

    const updateData: any = {};

    if (name) updateData.name = name;
    if (phoneNumber) updateData.phoneNumber = phoneNumber;
    if (role) updateData.role = role;

    if (req.file) {
      const existingUser = await userClient.findUnique({
        where: { id: userId },
      });

      if (existingUser?.imageId) {
        await deleteFromCloudinary(existingUser.imageId);
      }

      const imageData = await uploadToCloudinary(req.file.path, {
        folder: "user-profiles",
        format: "webp",
      });

      updateData.imageUrl = imageData.imageUrl;
      updateData.imageId = imageData.imageId;
    }

    const updatedUser = await userClient.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        name: true,
        email: true,
        phoneNumber: true,
        role: true,
        imageUrl: true,
        createdAt: true,
      },
    });

    res.status(200).json({
      message: "User updated successfully",
      data: updatedUser,
    });
  } catch (error) {
    console.error("Error updating user:", error);
    res.status(500).json({ error: "Failed to update user" });
  }
};

export const deleteUser = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.params.id;

    const user = await userClient.findUnique({
      where: { id: userId },
    });

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    if (user.imageId) {
      await deleteFromCloudinary(user.imageId);
    }

    await userClient.delete({
      where: { id: userId },
    });

    res.status(200).json({ message: "User deleted successfully" });
  } catch (error) {
    console.error("Error deleting user:", error);
    res.status(500).json({ error: "Failed to delete user" });
  }
};
export const createUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, email, role, phoneNumber } = req.body as {
      name?: string;
      email?: string;
      role?: "USER" | "ADMIN";
      phoneNumber?: string;
    };

    if (!name || !email) {
      res.status(400).json({ error: "name and email are required" });
      return;
    }

    const data: any = { name, email, role: role ?? "USER", phoneNumber };

    if (req.file) {
      const img = await uploadToCloudinary(req.file.path, {
        folder: "user-profiles",
        format: "webp",
      });
      data.imageUrl = img.imageUrl;
      data.imageId = img.imageId;
    }

    const user = await userClient.create({
      data,
      select: {
        id: true,
        name: true,
        email: true,
        phoneNumber: true,
        role: true,
        imageUrl: true,
        createdAt: true,
      },
    });

    res.status(201).json({ message: "User created", data: user });
  } catch (error: any) {
    // Unique email
    if (error?.code === "P2002") {
      res.status(409).json({ error: "Email already exists" });
      return;
    }
    console.error("Error creating user:", error);
    res.status(500).json({ error: "Failed to create user" });
  }
};