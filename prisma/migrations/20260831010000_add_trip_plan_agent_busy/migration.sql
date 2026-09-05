-- 同一计划同时只允许一个 agent 运行：并发运行会交错写对话历史，
-- 既可能回复错误请求，也会让 OpenAI 协议回放失效。
ALTER TABLE "TripPlan" ADD COLUMN "agentBusyUntil" TIMESTAMP(3);
