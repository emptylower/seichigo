-- CreateTable (2026-09-07 付费意向：BillingCheckoutIntent，含未登录点击)
CREATE TABLE "public"."BillingCheckoutIntent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "tier" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "locale" TEXT,
    "gated" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingCheckoutIntent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BillingCheckoutIntent_createdAt_idx" ON "public"."BillingCheckoutIntent"("createdAt");
CREATE INDEX "BillingCheckoutIntent_userId_idx" ON "public"."BillingCheckoutIntent"("userId");
