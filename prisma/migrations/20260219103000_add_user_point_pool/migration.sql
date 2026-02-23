-- CreateTable
CREATE TABLE "UserPointPool" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "pointId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "UserPointPool_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserPointPool_userId_pointId_key"
  ON "UserPointPool"("userId", "pointId");

CREATE INDEX "UserPointPool_userId_idx"
  ON "UserPointPool"("userId");

CREATE INDEX "UserPointPool_pointId_idx"
  ON "UserPointPool"("pointId");

-- AddForeignKey
ALTER TABLE "UserPointPool"
  ADD CONSTRAINT "UserPointPool_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserPointPool"
  ADD CONSTRAINT "UserPointPool_pointId_fkey"
  FOREIGN KEY ("pointId") REFERENCES "AnitabiPoint"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
