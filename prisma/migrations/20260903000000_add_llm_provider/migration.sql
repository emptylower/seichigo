-- CreateTable
CREATE TABLE "public"."LlmProvider" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "protocol" TEXT NOT NULL,
    "endpointUrl" TEXT NOT NULL,
    "apiKeyCiphertext" TEXT,
    "apiKeyHint" TEXT,
    "models" JSONB NOT NULL,
    "takeoverAgent" BOOLEAN NOT NULL DEFAULT false,
    "takeoverTranslation" BOOLEAN NOT NULL DEFAULT false,
    "agentModel" TEXT,
    "translationModel" TEXT,
    "source" TEXT NOT NULL DEFAULT 'custom',
    "envKey" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastTest" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LlmProvider_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LlmProvider_envKey_key" ON "public"."LlmProvider"("envKey");
