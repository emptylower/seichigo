-- 枚举层改造：官方 API 没有「列出全部作品」的入口（原用的 GET /bangumi 未被文档收录且已关闭），
-- 候选集只能来自库内 ID 轮转，按 lastCheckedAt 最旧优先。没有这一列同步无法选出候选。
--
-- 幂等写法：沙箱是手工 ALTER 加过这一列的，用 IF NOT EXISTS 避免重复应用时报错。

-- AlterTable
ALTER TABLE "AnitabiBangumiMeta"
ADD COLUMN IF NOT EXISTS "lastCheckedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AnitabiBangumiMeta_lastCheckedAt_idx" ON "AnitabiBangumiMeta"("lastCheckedAt");
