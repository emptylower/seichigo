-- 释放 busy 位必须校验持有者 token，防止 TTL 接管后旧请求的 finally
-- 无条件释放新持有者的锁（ABA）。
ALTER TABLE "TripPlan" ADD COLUMN "agentRunToken" TEXT;
