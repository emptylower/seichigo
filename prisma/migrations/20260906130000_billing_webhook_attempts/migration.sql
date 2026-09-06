-- F3（creem 评审修复）：BillingWebhookEvent 增加尝试次数，处理失败的事件可被对账重放
ALTER TABLE "public"."BillingWebhookEvent" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
