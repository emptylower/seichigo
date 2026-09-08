-- AlterTable（2026-09-08 图片资产迁 R2：只增可空列，回滚安全）
-- storageKey 为 null 表示尚未迁移到 R2，读路径回落 bytes 列；本期不删 bytes。
ALTER TABLE "Asset" ADD COLUMN "storageKey" TEXT,
ADD COLUMN "byteLength" INTEGER,
ADD COLUMN "width" INTEGER,
ADD COLUMN "height" INTEGER;
