"use client";

export const MAX_CUSTOM_AVATAR_SIZE_BYTES = 5 * 1024 * 1024;
const SUPPORTED_CUSTOM_AVATAR_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);

export interface CustomAvatarUploadLike {
  size: number;
  type: string;
}

export function validateCustomAvatarFile(file: CustomAvatarUploadLike): string | null {
  if (!SUPPORTED_CUSTOM_AVATAR_TYPES.has(file.type.toLowerCase())) {
    return "Use a JPG, PNG, GIF, or WEBP image.";
  }

  if (file.size > MAX_CUSTOM_AVATAR_SIZE_BYTES) {
    return "Image must be 5 MB or smaller.";
  }

  return null;
}

export function resizeImageToBase64(file: File, maxSize = 64): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = maxSize;
        canvas.height = maxSize;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas unavailable"));
          return;
        }

        const sourceSize = Math.min(image.width, image.height);
        const sourceX = (image.width - sourceSize) / 2;
        const sourceY = (image.height - sourceSize) / 2;
        ctx.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, maxSize, maxSize);
        resolve(canvas.toDataURL("image/jpeg", 0.72));
      };
      image.onerror = () => reject(new Error("Image decode failed"));
      image.src = typeof reader.result === "string" ? reader.result : "";
    };
    reader.onerror = () => reject(new Error("Image read failed"));
    reader.readAsDataURL(file);
  });
}
