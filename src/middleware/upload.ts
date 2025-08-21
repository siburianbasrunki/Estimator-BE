import multer from "multer";
import path from "path";
import fs from "fs";
import { Request } from "express";

// Pastikan folder uploads ada
const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Konfigurasi penyimpanan sementara
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

// Filter untuk memastikan hanya file gambar yang diupload
const fileFilter = (
  req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  const allowedFileTypes = [".jpg", ".jpeg", ".png", ".gif"];
  const ext = path.extname(file.originalname).toLowerCase();

  if (allowedFileTypes.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error("Hanya file JPG, JPEG, PNG dan GIF yang diperbolehkan!"));
  }
};

export const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});
type MakeUploaderOptions = {
  /** Ekstensi file yang diizinkan (huruf kecil, dengan titik) */
  allowedExts: string[];
  /** MIME types yang diizinkan */
  allowedMimes: string[];
  /** Batas ukuran file dalam MB */
  maxSizeMB: number;
  /** Subfolder di dalam /uploads */
  subfolder?: string;
};

const ensureDir = (dir: string) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

const rootUploadDir = path.join(process.cwd(), "uploads");
ensureDir(rootUploadDir);

function makeDiskStorage(subfolder?: string) {
  const dest = subfolder ? path.join(rootUploadDir, subfolder) : rootUploadDir;
  ensureDir(dest);

  return multer.diskStorage({
    destination: function (_req, _file, cb) {
      cb(null, dest);
    },
    filename: function (_req, file, cb) {
      const safeName = file.originalname.replace(/[^\w.\-() ]+/g, "_");
      cb(null, `${Date.now()}-${safeName}`);
    },
  });
}
function makeUploader(opts: MakeUploaderOptions) {
  const storage = makeDiskStorage(opts.subfolder);

  const fileFilter: multer.Options["fileFilter"] = (
    _req: Request,
    file: Express.Multer.File,
    cb
  ) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const okExt = opts.allowedExts.includes(ext);
    const okMime = opts.allowedMimes.includes(file.mimetype);

    if (okExt || okMime) return cb(null, true);

    const msg =
      `File type not allowed. Allowed: ${opts.allowedExts.join(", ")} ` +
      `(mime: ${opts.allowedMimes.join(", ")})`;
    cb(new Error(msg));
  };

  return multer({
    storage,
    fileFilter,
    limits: { fileSize: opts.maxSizeMB * 1024 * 1024 },
  });
}

export const uploadExcelCsv = makeUploader({
  allowedExts: [".xlsx", ".csv", ".xls"],
  allowedMimes: [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
    "application/vnd.ms-excel", // .xls
    "text/csv",
    "application/csv",
  ],
  maxSizeMB: 25,
  subfolder: "imports",
});
